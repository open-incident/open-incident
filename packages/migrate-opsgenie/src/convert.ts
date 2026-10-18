/**
 * From Opsgenie's model to Open Incident's, without a database: rotations,
 * time restrictions, layers, escalations, routing criteria, priorities, and
 * what each integration becomes.
 *
 * Where the two count differently the conversion keeps the behaviour, not the
 * shape: absolute escalation delays become relative ones, an upper layer
 * becomes a condition on working hours ahead of the layer it hides, a weekday
 * restriction becomes a working-hours gate, P5 becomes P4, and a repeat
 * becomes a retry node. What cannot be kept is said — every function returns
 * its notes — and the eight-week comparison shows where it bites.
 */
import type {
  AlertSourceKind,
  Condition,
  ConditionGroup,
  EscalationGraph,
  EscalationNode,
  EscalationTarget,
  RotationInterval,
} from "@openincident/db";
import { DAY_NUMBER, hhmm, partsOf } from "./zone";
import type {
  OgCondition,
  OgCriteria,
  OgEscalation,
  OgOverride,
  OgPeriod,
  OgRotation,
  OgSchedule,
  OgTimeRestriction,
  OgTimeline,
} from "./types";

/* ---------- People ---------- */

/** Who an Opsgenie user is here: a member id, or nobody (a gap, or not decided yet). */
export type PeopleIndex = Map<string, string | null>;

/* ---------- Gates: a working-hours window a layer only holds inside ---------- */

export type Gate = { days: number[]; startTime: string; endTime: string; timezone: string };

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

export function inGate(at: Date, g: Gate): boolean {
  const p = partsOf(at, g.timezone);
  const now = p.hour * 60 + p.minute;
  const [sh, sm] = g.startTime.split(":").map(Number) as [number, number];
  const [eh, em] = g.endTime.split(":").map(Number) as [number, number];
  const start = sh * 60 + sm;
  const end = eh * 60 + em === 0 ? 1440 : eh * 60 + em;
  if (end > start) return g.days.includes(p.weekday) && now >= start && now < end;
  const yesterday = p.weekday === 1 ? 7 : p.weekday - 1;
  return (g.days.includes(p.weekday) && now >= start) || (g.days.includes(yesterday) && now < end);
}

/**
 * What a time restriction becomes: a daily active window on the rotation
 * itself, and/or a gate for the days it does not cover. `exact` is false when
 * the restriction had to be widened.
 */
export function convertRestriction(
  r: OgTimeRestriction | null | undefined,
  tz: string,
): {
  activeStart: string | null;
  activeEnd: string | null;
  gate: Gate | null;
  exact: boolean;
} {
  if (!r) return { activeStart: null, activeEnd: null, gate: null, exact: true };
  if (r.type === "time-of-day") {
    const { startHour, startMin, endHour, endMin } = r.restriction;
    return {
      activeStart: hhmm(startHour, startMin),
      activeEnd: hhmm(endHour, endMin),
      gate: null,
      exact: true,
    };
  }
  const ranges = r.restrictions;
  if (ranges.length === 0) return { activeStart: null, activeEnd: null, gate: null, exact: true };
  // Same-day windows with the same hours: days + a daily window.
  const sameDay = ranges.every((x) => x.startDay === x.endDay);
  const first = ranges[0]!;
  const sameHours = ranges.every(
    (x) =>
      x.startHour === first.startHour &&
      x.startMin === first.startMin &&
      x.endHour === first.endHour &&
      x.endMin === first.endMin,
  );
  if (sameDay && sameHours) {
    const days = [...new Set(ranges.map((x) => DAY_NUMBER[x.startDay]!))].sort();
    const s = hhmm(first.startHour, first.startMin);
    const e = hhmm(first.endHour, first.endMin);
    return {
      activeStart: s,
      activeEnd: e,
      gate: { days, startTime: s, endTime: e, timezone: tz },
      exact: true,
    };
  }
  // Whole days: from a day at 00:00 to a later day at 00:00 (Saturday → Monday).
  const wholeDays = ranges.every(
    (x) => x.startHour === 0 && x.startMin === 0 && x.endHour === 0 && x.endMin === 0,
  );
  if (wholeDays) {
    const days = new Set<number>();
    for (const x of ranges) {
      let d = DAY_NUMBER[x.startDay]!;
      const end = DAY_NUMBER[x.endDay]!;
      for (let guard = 0; guard < 7; guard++) {
        days.add(d);
        d = d === 7 ? 1 : d + 1;
        if (d === end) break;
      }
    }
    return {
      activeStart: null,
      activeEnd: null,
      gate: { days: [...days].sort(), startTime: "00:00", endTime: "00:00", timezone: tz },
      exact: true,
    };
  }
  // Anything else is widened to its days and its earliest start / latest end.
  const days = [...new Set(ranges.map((x) => DAY_NUMBER[x.startDay]!))].sort();
  const minStart = Math.min(...ranges.map((x) => x.startHour * 60 + x.startMin));
  const maxEnd = Math.max(...ranges.map((x) => x.endHour * 60 + x.endMin || 1440));
  const s = hhmm(Math.floor(minStart / 60), minStart % 60);
  const e = maxEnd >= 1440 ? "00:00" : hhmm(Math.floor(maxEnd / 60), maxEnd % 60);
  return {
    activeStart: null,
    activeEnd: null,
    gate: { days, startTime: s, endTime: e, timezone: tz },
    exact: false,
  };
}

/* ---------- Schedules ---------- */

export type ShapeRotation = {
  id: string;
  ogRotationId: string;
  name: string;
  interval: RotationInterval;
  handoverDay: number;
  activeStart: string | null;
  activeEnd: string | null;
  memberIds: string[];
  effectiveFrom: Date;
  position: number;
};

export type ShapeOverride = {
  id: string;
  rotationId: string | null;
  memberId: string | null;
  startAt: Date;
  endAt: Date;
  reason: string;
};

export type ShapePart = {
  /** The Opsgenie rotation this part is (split schedules), or "all". */
  key: string;
  name: string;
  timezone: string;
  handoverTime: string;
  rotations: ShapeRotation[];
  overrides: ShapeOverride[];
  gate: Gate | null;
  /** Once imported. */
  scheduleId?: string;
  gateSetId?: string;
};

export type ScheduleShape = {
  ogId: string;
  name: string;
  /** precedence: the first part whose gate holds decides; union: every part whose gate holds. */
  mode: "union" | "precedence";
  /** Top layer first in precedence mode. */
  parts: ShapePart[];
  notes: string[];
};

/** A member id that stands for "nobody": a person left as a gap, or not decided yet. */
export const NOBODY_PREFIX = "~";
export const isNobody = (memberId: string | null | undefined) =>
  !memberId || memberId.startsWith(NOBODY_PREFIX);

/**
 * Whether Opsgenie lets an upper layer hide the ones under it: read from the
 * timeline, where a lower rotation's own period disappears from the final
 * timeline while a later rotation has someone on call.
 */
export function detectPrecedence(timeline: OgTimeline | null | undefined): boolean {
  const base = timeline?.baseTimeline?.rotations ?? [];
  const final = timeline?.finalTimeline?.rotations ?? [];
  if (base.length < 2) return false;
  const spans = (periods: OgPeriod[]) =>
    periods
      .filter((p) => p.recipient?.type === "user")
      .map((p) => ({ s: new Date(p.startDate).getTime(), e: new Date(p.endDate).getTime() }));
  for (let i = 0; i < base.length; i++) {
    const lower = spans(base[i]!.periods ?? []);
    const lowerFinal = spans(final.find((r) => r.id === base[i]!.id)?.periods ?? []);
    for (let j = i + 1; j < base.length; j++) {
      const upper = spans(base[j]!.periods ?? []);
      for (const a of lower)
        for (const b of upper) {
          const s = Math.max(a.s, b.s);
          const e = Math.min(a.e, b.e);
          if (e <= s) continue;
          const mid = (s + e) / 2;
          const kept = lowerFinal.some((f) => f.s <= mid && f.e > mid);
          return !kept;
        }
    }
  }
  return false;
}

function intervalOf(rot: OgRotation): { interval: RotationInterval; exact: boolean } {
  const len = Math.max(1, rot.length ?? 1);
  if (rot.type === "weekly") return { interval: "weekly", exact: len === 1 };
  if (rot.type === "daily")
    return { interval: len === 7 ? "weekly" : "daily", exact: len === 1 || len === 7 };
  return { interval: "daily", exact: false };
}

export type StoredSchedule = OgSchedule & {
  overrides?: OgOverride[];
  timeline?: OgTimeline | null;
  /** Slots fixed in one click in the preview: written as overrides at import. */
  fixes?: Array<{ partKey: string; start: string; end: string; memberId: string | null }>;
};

/**
 * The Open Incident shape of an Opsgenie schedule: one schedule, or one per
 * layer when layers take precedence or a layer is only on some days.
 */
export function shapeSchedule(s: StoredSchedule, people: PeopleIndex): ScheduleShape {
  const tz = s.timezone || "UTC";
  const notes: string[] = [];
  const rotations = s.rotations ?? [];
  const precedence = detectPrecedence(s.timeline);
  const converted = rotations.map((rot, i) => {
    const start = new Date(rot.startDate);
    const p = partsOf(start, tz);
    const { interval, exact } = intervalOf(rot);
    if (!exact) notes.push(`rotation:${rot.name}:interval`);
    const r = convertRestriction(rot.timeRestriction, tz);
    if (!r.exact) notes.push(`rotation:${rot.name}:restriction`);
    const memberIds: string[] = [];
    for (const part of rot.participants) {
      if (part.type !== "user") {
        notes.push(`rotation:${rot.name}:participant`);
        continue;
      }
      const m = people.get(part.id);
      memberIds.push(m ?? `${NOBODY_PREFIX}${part.id}`);
    }
    const shape: ShapeRotation = {
      id: rot.id,
      ogRotationId: rot.id,
      name: rot.name,
      interval,
      handoverDay: p.weekday,
      activeStart: r.activeStart,
      activeEnd: r.activeEnd,
      memberIds,
      effectiveFrom: start,
      position: i,
    };
    // A layer that wins over others is gated by its own window, even a daily one.
    let gate = r.gate;
    if (!gate && precedence && r.activeStart && r.activeEnd)
      gate = { days: ALL_DAYS, startTime: r.activeStart, endTime: r.activeEnd, timezone: tz };
    return { rot, shape, gate, handover: hhmm(p.hour, p.minute) };
  });

  const handovers = new Set(converted.map((c) => c.handover));
  const split = precedence || converted.some((c) => c.gate) || handovers.size > 1;
  const overrideFor = (o: OgOverride, rotationId: string | null, n: number): ShapeOverride => ({
    id: `og-override-${n}`,
    rotationId,
    memberId:
      o.user.type === "user" && o.user.id
        ? (people.get(o.user.id) ?? `${NOBODY_PREFIX}${o.user.id}`)
        : null,
    startAt: new Date(o.startDate),
    endAt: new Date(o.endDate),
    reason: "override",
  });
  const overrides = s.overrides ?? [];
  let parts: ShapePart[];
  if (!split) {
    parts = [
      {
        key: "all",
        name: s.name,
        timezone: tz,
        handoverTime: converted[0]?.handover ?? "09:00",
        rotations: converted.map((c) => c.shape),
        overrides: overrides.flatMap((o, n) =>
          o.rotations && o.rotations.length
            ? o.rotations.map((r) => overrideFor(o, r.id, n))
            : [overrideFor(o, null, n)],
        ),
        gate: null,
      },
    ];
  } else {
    const ordered = precedence ? converted.slice().reverse() : converted;
    parts = ordered.map((c, i) => ({
      key: c.rot.id,
      name:
        i === ordered.length - 1 && precedence
          ? s.name
          : precedence
            ? `${s.name} · ${c.rot.name}`
            : converted.length > 1
              ? `${s.name} · ${c.rot.name}`
              : s.name,
      timezone: tz,
      handoverTime: c.handover,
      rotations: [{ ...c.shape, position: 0 }],
      overrides: overrides
        .filter((o) => !o.rotations?.length || o.rotations.some((r) => r.id === c.rot.id))
        .map((o, n) => overrideFor(o, o.rotations?.length ? c.rot.id : null, n)),
      gate: c.gate,
    }));
  }
  for (const f of s.fixes ?? []) {
    const part = parts.find((x) => x.key === f.partKey) ?? parts[0];
    part?.overrides.push({
      id: `fix-${f.start}`,
      rotationId: null,
      memberId: f.memberId,
      startAt: new Date(f.start),
      endAt: new Date(f.end),
      reason: "override",
    });
  }
  return { ogId: s.id, name: s.name, mode: precedence ? "precedence" : "union", parts, notes };
}

/** The design's one-line description of a schedule: "2 layers · weekend on top". */
export function describeSchedule(s: StoredSchedule): {
  kind: "layers" | "rotations" | "rotation";
  count: number;
  detail:
    | "follow-the-sun"
    | "weekend-on-top"
    | "weekly"
    | "daily"
    | "weekend"
    | "business-hours"
    | "restricted"
    | null;
} {
  const rotations = s.rotations ?? [];
  const precedence = detectPrecedence(s.timeline);
  if (precedence) {
    const top = rotations[rotations.length - 1];
    const g = top ? convertRestriction(top.timeRestriction, s.timezone).gate : null;
    const weekendTop = Boolean(g && g.days.length <= 2 && g.days.every((d) => d >= 6));
    return {
      kind: "layers",
      count: rotations.length,
      detail: weekendTop ? "weekend-on-top" : null,
    };
  }
  if (rotations.length > 1) {
    const daily = rotations.every((r) => r.timeRestriction?.type === "time-of-day");
    return { kind: "rotations", count: rotations.length, detail: daily ? "follow-the-sun" : null };
  }
  const r = rotations[0];
  if (!r) return { kind: "rotation", count: 0, detail: null };
  const g = convertRestriction(r.timeRestriction, s.timezone).gate;
  if (g && g.days.length && g.days.every((d) => d >= 6))
    return { kind: "rotation", count: 1, detail: "weekend" };
  if (g && g.days.length === 5 && g.days.every((d) => d <= 5))
    return { kind: "rotation", count: 1, detail: "business-hours" };
  if (r.timeRestriction) return { kind: "rotation", count: 1, detail: "restricted" };
  return { kind: "rotation", count: 1, detail: r.type === "daily" ? "daily" : "weekly" };
}

/* ---------- Escalations ---------- */

export type EscalationContext = {
  member: (ogUserId: string) => string | null;
  team: (ogTeamId: string) => string | null;
  schedule: (ogScheduleId: string) => ScheduleShape | null;
};

const minutesOf = (d: { timeAmount: number; timeUnit?: string }) =>
  d.timeUnit === "hours"
    ? d.timeAmount * 60
    : d.timeUnit === "days"
      ? d.timeAmount * 1440
      : d.timeAmount;

/** Opsgenie's rules grouped by delay: the levels, with their absolute delays. */
export function escalationLevels(
  esc: OgEscalation,
): Array<{ delay: number; rules: OgEscalation["rules"] }> {
  const by = new Map<number, OgEscalation["rules"]>();
  for (const r of esc.rules) {
    const d = minutesOf(r.delay);
    by.set(d, [...(by.get(d) ?? []), r]);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([delay, rules]) => ({ delay, rules }));
}

/** "0 · 10 · 25 min after alert" and "now · +10 · +15 min", as numbers. */
export function delaysOf(esc: OgEscalation): { absolute: number[]; relative: number[] } {
  const absolute = escalationLevels(esc).map((l) => l.delay);
  const relative = absolute.map((d, i) => (i === 0 ? d : d - absolute[i - 1]!));
  return { absolute, relative };
}

/** Targets for one schedule part, in a level. */
const scheduleTarget = (
  scheduleId: string,
  mode: "current" | "next" | "everyone",
): EscalationTarget => ({
  kind: "schedule",
  scheduleId,
  mode,
});

/**
 * The escalation graph: one level per delay (relative timeouts), conditions
 * ahead of a level for gated or layered schedules, a delay where a branch has
 * nobody (so the next level still comes on time), a retry node for a repeat.
 */
export function escalationGraph(
  esc: OgEscalation,
  ctx: EscalationContext,
): { graph: EscalationGraph; notes: string[] } {
  const notes: string[] = [];
  const levels = escalationLevels(esc);
  const nodes: EscalationNode[] = [];
  let seq = 0;
  const nid = () => `n${++seq}`;
  const repeat = esc.repeat && esc.repeat.count > 0 ? esc.repeat : null;
  // One block per level: where it is entered, and the nodes that wait (to wire onwards).
  const blocks: Array<{ entry: string; leaves: Array<{ next: string | null }> }> = [];

  levels.forEach((lvl, i) => {
    const nextDelay = levels[i + 1]?.delay;
    // Relative: the gap to the next level. The last one hands straight to the
    // repeat when there is one, and otherwise waits half an hour before ending.
    const timeout = nextDelay !== undefined ? nextDelay - lvl.delay : repeat ? 0 : 30;
    const plain: EscalationTarget[] = [];
    let gated: { shape: ScheduleShape; mode: "current" | "next" | "everyone" } | null = null;
    for (const r of lvl.rules) {
      if (r.condition === "if-not-closed") notes.push(`escalation:${esc.name}:if-not-closed`);
      const rec = r.recipient;
      if (rec.type === "user") {
        const m = ctx.member(rec.id);
        if (m && !isNobody(m)) plain.push({ kind: "member", memberId: m });
        else notes.push(`escalation:${esc.name}:user`);
      } else if (rec.type === "team") {
        const t = ctx.team(rec.id);
        if (t) plain.push({ kind: "team", teamId: t });
        else notes.push(`escalation:${esc.name}:team`);
      } else if (rec.type === "schedule") {
        const shape = ctx.schedule(rec.id);
        const mode =
          r.notifyType === "next" ? "next" : r.notifyType === "all" ? "everyone" : "current";
        if (r.notifyType === "previous") notes.push(`escalation:${esc.name}:previous`);
        if (!shape) {
          notes.push(`escalation:${esc.name}:schedule`);
          continue;
        }
        const only = shape.parts.length === 1 ? shape.parts[0]! : null;
        if (only && !only.gate) plain.push(scheduleTarget(only.scheduleId ?? only.key, mode));
        else if (!gated) gated = { shape, mode };
        else {
          notes.push(`escalation:${esc.name}:two-gated`);
          for (const part of shape.parts)
            plain.push(scheduleTarget(part.scheduleId ?? part.key, mode));
        }
      } else {
        notes.push(`escalation:${esc.name}:nested`);
      }
    }
    const leaves: Array<{ next: string | null }> = [];
    const leaf = (t: EscalationTarget[]): string => {
      const n: EscalationNode = t.length
        ? {
            id: nid(),
            kind: "level",
            targets: t,
            urgency: "high",
            ackTimeoutMinutes: timeout,
            retries: 0,
            retryIntervalMinutes: 5,
            next: null,
          }
        : // Nobody on this branch: wait as long as the level would have, so the next comes on time.
          { id: nid(), kind: "delay", minutes: timeout, next: null };
      nodes.push(n);
      leaves.push(n as { next: string | null });
      return n.id;
    };
    const condition = (setId: string, whenTrue: string, whenFalse: string): string => {
      const id = nid();
      nodes.push({
        id,
        kind: "condition",
        test: { type: "working_hours", setId },
        whenTrue,
        whenFalse,
      });
      return id;
    };
    let entry: string;
    if (!gated) entry = leaf(plain);
    else {
      const { shape, mode } = gated;
      const target = (p: ShapePart) => scheduleTarget(p.scheduleId ?? p.key, mode);
      const gateId = (p: ShapePart) => p.gateSetId ?? `gate:${p.key}`;
      if (shape.mode === "precedence") {
        // Top layer first: inside its window it decides, otherwise the next one down.
        const build = (k: number): string => {
          const part = shape.parts[k]!;
          const here = leaf([...plain, target(part)]);
          if (!part.gate) return here;
          const otherwise = k + 1 < shape.parts.length ? build(k + 1) : leaf(plain);
          return condition(gateId(part), here, otherwise);
        };
        entry = build(0);
      } else {
        const always = [...plain, ...shape.parts.filter((p) => !p.gate).map(target)];
        const withGate = shape.parts.filter((p) => p.gate);
        if (withGate.length > 1) notes.push(`schedule:${shape.name}:gates`);
        const yes = leaf([...always, ...withGate.map(target)]);
        const no = leaf(always);
        entry = condition(gateId(withGate[0]!), yes, no);
      }
    }
    blocks.push({ entry, leaves });
  });

  let retryId: string | null = null;
  if (repeat && blocks.length) {
    retryId = nid();
    nodes.push({
      id: retryId,
      kind: "retry",
      toNodeId: blocks[0]!.entry,
      maxLoops: repeat.count,
      intervalMinutes: Math.max(1, repeat.waitInterval),
      next: null,
    });
  }
  blocks.forEach((b, i) => {
    const next = blocks[i + 1]?.entry ?? retryId;
    for (const l of b.leaves) l.next = next;
  });
  return { graph: { start: blocks[0]?.entry ?? null, nodes }, notes };
}

/* ---------- Routing criteria ---------- */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The alert attribute an Opsgenie condition field reads here. */
function attributeFor(c: OgCondition): string | null {
  switch (c.field) {
    case "message":
      return "title";
    case "priority":
      return "priority";
    case "source":
      return "source_name";
    case "tags":
      return "tags";
    case "alias":
      return "alias";
    case "entity":
      return "entity";
    case "description":
      return "description";
    case "details":
    case "extra-properties":
      return c.key ? c.key : null;
    default:
      return null;
  }
}

function convertCondition(c: OgCondition, p5ToP4: boolean): Condition | null {
  const attribute = attributeFor(c);
  if (!attribute) return null;
  const value = c.expectedValue ?? "";
  // P5 is P4 here: a condition that told the two apart cannot be kept.
  if (attribute === "priority" && p5ToP4 && /^p5$/i.test(value)) return null;
  const not = Boolean(c.not);
  switch (c.operation) {
    case "equals":
    case "equals-ignore-whitespace":
      return { attribute, op: not ? "neq" : "eq", value };
    case "contains":
      return not
        ? { attribute, op: "matches", value: `^(?![\\s\\S]*${esc(value)})` }
        : { attribute, op: "contains", value };
    case "starts-with":
      return { attribute, op: "matches", value: not ? `^(?!${esc(value)})` : `^${esc(value)}` };
    case "ends-with":
      return {
        attribute,
        op: "matches",
        value: not ? `^(?![\\s\\S]*${esc(value)}$)` : `${esc(value)}$`,
      };
    case "matches":
      return not ? null : { attribute, op: "matches", value };
    case "is-empty":
      return { attribute, op: not ? "exists" : "missing" };
    case "contains-key":
      return c.field === "details" || c.field === "extra-properties"
        ? { attribute: value, op: not ? "missing" : "exists" }
        : null;
    case "greater-than":
    case "less-than": {
      if (attribute !== "priority") return null;
      const n = Number(value.replace(/\D/g, ""));
      const all = p5ToP4 ? [1, 2, 3, 4] : [1, 2, 3, 4, 5];
      const holds = (x: number) => (c.operation === "greater-than" ? x > n : x < n);
      const list = all.filter((x) => holds(x) !== not).map((x) => `P${x}`);
      return list.length ? { attribute, op: "in", value: list.join(",") } : null;
    }
    default:
      return null;
  }
}

/** Opsgenie criteria as condition groups (ORed groups of ANDed conditions). */
export function convertCriteria(
  c: OgCriteria,
  opts: { p5ToP4: boolean },
): { groups: ConditionGroup[]; dropped: OgCondition[] } {
  const dropped: OgCondition[] = [];
  if (c.type === "match-all") return { groups: [], dropped };
  const converted: Condition[] = [];
  for (const cond of c.conditions ?? []) {
    const x = convertCondition(cond, opts.p5ToP4);
    if (x) converted.push(x);
    else dropped.push(cond);
  }
  if (c.type === "match-all-conditions")
    return { groups: converted.length ? [{ all: converted }] : [], dropped };
  return { groups: converted.map((x) => ({ all: [x] })), dropped };
}

/* ---------- Integrations ---------- */

export type Activity = "live" | "quiet" | "silent";

/** Live: an alert in the last 7 days. Quiet: in the last 90. Otherwise silent. */
export function activityOf(lastAlertAt: string | null | undefined, now: Date): Activity {
  if (!lastAlertAt) return "silent";
  const age = now.getTime() - new Date(lastAlertAt).getTime();
  if (age <= 7 * 86_400_000) return "live";
  if (age <= 90 * 86_400_000) return "quiet";
  return "silent";
}

export type IntegrationTarget =
  | { kind: AlertSourceKind; label: "source"; tool: string; genieKey?: boolean }
  | { kind: "heartbeat"; label: "heartbeat" }
  | { kind: "skip"; label: "skip" | "skip-unless" };

/** What an Opsgenie integration becomes here. */
export function targetOf(type: string, activity: Activity, hadAlerts: boolean): IntegrationTarget {
  if (type === "Heartbeat") return { kind: "heartbeat", label: "heartbeat" };
  if (activity === "silent") return { kind: "skip", label: hadAlerts ? "skip-unless" : "skip" };
  const t = type.toLowerCase();
  if (t.includes("datadog")) return { kind: "datadog", label: "source", tool: "Datadog" };
  if (t.includes("prometheus") || t.includes("alertmanager"))
    return { kind: "prometheus", label: "source", tool: "Prometheus" };
  if (t.includes("grafana")) return { kind: "grafana", label: "source", tool: "Grafana" };
  if (t.includes("sentry")) return { kind: "sentry", label: "source", tool: "Sentry" };
  if (t.includes("cloudwatch")) return { kind: "cloudwatch", label: "source", tool: "CloudWatch" };
  if (t === "email") return { kind: "email", label: "source", tool: "Email" };
  if (t === "api") return { kind: "http", label: "source", tool: "HTTP", genieKey: true };
  return { kind: "http", label: "source", tool: "HTTP" };
}

/** What has to change in the tool so it posts here instead: the checklist line's hint. */
export function repointHint(
  type: string,
):
  | "webhook-url"
  | "receiver-url"
  | "contact-point"
  | "alert-rule-action"
  | "sns-subscription"
  | "genie-key"
  | "new-address"
  | "ping-url" {
  const t = type.toLowerCase();
  if (t === "heartbeat") return "ping-url";
  if (t.includes("prometheus") || t.includes("alertmanager")) return "receiver-url";
  if (t.includes("grafana")) return "contact-point";
  if (t.includes("sentry")) return "alert-rule-action";
  if (t.includes("cloudwatch")) return "sns-subscription";
  if (t === "api") return "genie-key";
  if (t === "email") return "new-address";
  return "webhook-url";
}

/** Two letters for the integration's monochrome glyph: "Dd", "Pr", "Og". */
export function glyphOf(type: string, name: string): string {
  const known: Record<string, string> = {
    datadog: "Dd",
    prometheus: "Pr",
    grafana: "Gr",
    sentry: "Se",
    amazoncloudwatch: "Cw",
    cloudwatch: "Cw",
    api: "Ap",
    email: "Em",
    heartbeat: "Hb",
    newrelic: "Nr",
    zabbix: "Zb",
    webhook: name.toLowerCase().includes("uptime") ? "Up" : "Wh",
  };
  const k = known[type.toLowerCase()];
  if (k) return k;
  const clean = type.replace(/[^A-Za-z]/g, "");
  return clean.slice(0, 1).toUpperCase() + clean.slice(1, 2).toLowerCase() || "Og";
}

/** The type as people read it: "API (GenieKey)", "CloudWatch", "New Relic". */
export function typeLabel(type: string): string {
  const map: Record<string, string> = {
    AmazonCloudWatch: "CloudWatch",
    API: "API (GenieKey)",
    NewRelic: "New Relic",
  };
  return map[type] ?? type;
}
