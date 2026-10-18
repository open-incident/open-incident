/**
 * Who is on call, slot by slot, on both sides.
 *
 * The Opsgenie side is Opsgenie's own final timeline — whatever its rules,
 * that is who it pages. The Open Incident side is computed by the product's
 * rotation arithmetic over the converted (or imported) schedules, with the
 * conditions the policies will put ahead of each layer. Both are reduced to
 * the member each side would page here, and every slot where they differ is
 * returned with its cause, so the screen can offer the fix that applies.
 */
import { onCallAt, shiftsBetween } from "@openincident/oncall";
import {
  inGate,
  isNobody,
  type PeopleIndex,
  type ScheduleShape,
  type ShapePart,
  type StoredSchedule,
} from "./convert";
import { partsOf, plusLocalDays, startOfLocalDay, wallClock } from "./zone";

export type SlotDiff = {
  start: Date;
  end: Date;
  /** Who Opsgenie has on call, by name, and who that is here. */
  og: Array<{ ogUserId: string; name: string; memberId: string | null }>;
  /** Who Open Incident would page (active members only). */
  oi: string[];
  /** pending: an invitation not accepted yet · override: an Opsgenie override · lossy: the conversion. */
  cause: "pending" | "override" | "lossy";
  /** The part (layer) in force, where a fix lands. */
  partKey: string;
};

/** The members Open Incident would page for a schedule at an instant, and the layer that decided. */
export function oiMembersAt(
  shape: ScheduleShape,
  at: Date,
): { members: string[]; partKey: string } {
  const members = (part: ShapePart) =>
    onCallAt(
      { timezone: part.timezone, handoverTime: part.handoverTime },
      part.rotations,
      part.overrides,
      at,
    )
      .map((x) => x.memberId)
      .filter((m): m is string => Boolean(m));
  if (shape.mode === "precedence") {
    for (const part of shape.parts)
      if (!part.gate || inGate(at, part.gate)) return { members: members(part), partKey: part.key };
    return { members: [], partKey: shape.parts[shape.parts.length - 1]?.key ?? "all" };
  }
  const out = new Set<string>();
  for (const part of shape.parts)
    if (!part.gate || inGate(at, part.gate)) for (const m of members(part)) out.add(m);
  return { members: [...out], partKey: shape.parts[0]?.key ?? "all" };
}

function gateEdges(part: ShapePart, from: Date, to: Date): number[] {
  if (!part.gate) return [];
  const out: number[] = [];
  const tz = part.gate.timezone;
  for (
    let d = startOfLocalDay(new Date(from.getTime() - 86_400_000), tz);
    d.getTime() < to.getTime();
    d = plusLocalDays(d, 1, tz)
  ) {
    const p = partsOf(d, tz);
    for (const t of [part.gate.startTime, part.gate.endTime]) {
      const [h, m] = t.split(":").map(Number) as [number, number];
      const e = wallClock(p.year, p.month, p.day, h, m, tz).getTime();
      if (e > from.getTime() && e < to.getTime()) out.push(e);
    }
  }
  return out;
}

const key = (xs: Array<string | null>) =>
  xs
    .filter((x): x is string => Boolean(x))
    .sort()
    .join(",");

/**
 * Compares a schedule over [from, to). `active` is the set of members who
 * would actually receive a page (an invited member does not).
 */
export function compareSchedule(
  stored: StoredSchedule,
  shape: ScheduleShape,
  people: PeopleIndex,
  active: Set<string>,
  names: Map<string, string>,
  from: Date,
  to: Date,
): SlotDiff[] {
  // A slot fixed here (handed to someone in the preview) is meant to differ from Opsgenie.
  const fixes = (stored.fixes ?? []).map((f) => ({
    s: new Date(f.start).getTime(),
    e: new Date(f.end).getTime(),
    memberId: f.memberId,
  }));
  const periods = (stored.timeline?.finalTimeline?.rotations ?? []).flatMap((r) =>
    (r.periods ?? [])
      .filter((p) => p.recipient?.type === "user" && p.recipient.id)
      .map((p) => ({
        s: new Date(p.startDate).getTime(),
        e: new Date(p.endDate).getTime(),
        user: p.recipient!.id!,
        override: p.type === "override",
      })),
  );
  const edges = new Set<number>([from.getTime(), to.getTime()]);
  for (const p of periods)
    for (const x of [p.s, p.e]) if (x > from.getTime() && x < to.getTime()) edges.add(x);
  for (const part of shape.parts) {
    for (const rot of part.rotations)
      for (const sh of shiftsBetween(
        { timezone: part.timezone, handoverTime: part.handoverTime },
        rot,
        part.overrides,
        from,
        to,
      ))
        for (const x of [sh.startAt.getTime(), sh.endAt.getTime()])
          if (x > from.getTime() && x < to.getTime()) edges.add(x);
    for (const x of gateEdges(part, from, to)) edges.add(x);
  }
  const sorted = [...edges].sort((a, b) => a - b);
  type Seg = { s: number; e: number; ogKey: string; oiKey: string; diff: SlotDiff | null };
  const segs: Seg[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i]!;
    const e = sorted[i + 1]!;
    if (e - s < 60_000) continue;
    const mid = new Date((s + e) / 2);
    const here = periods.filter((p) => p.s <= mid.getTime() && p.e > mid.getTime());
    const og = here.map((p) => {
      const m = people.get(p.user);
      return {
        ogUserId: p.user,
        name: names.get(p.user) ?? p.user,
        memberId: m && !isNobody(m) ? m : null,
      };
    });
    const fix = fixes.find((f) => f.s <= mid.getTime() && f.e > mid.getTime());
    const intended = fix ? [fix.memberId] : og.map((x) => x.memberId);
    const { members, partKey } = oiMembersAt(shape, mid);
    const oi = members.filter((m) => !isNobody(m) && active.has(m));
    const ogKey = key(intended);
    const oiKey = key(oi);
    let diff: SlotDiff | null = null;
    if (ogKey !== oiKey) {
      const pending = intended.some((m) => m && !active.has(m));
      diff = {
        start: new Date(s),
        end: new Date(e),
        og,
        oi,
        cause: pending ? "pending" : here.some((p) => p.override) ? "override" : "lossy",
        partKey,
      };
    }
    const last = segs[segs.length - 1];
    if (last && last.e === s && last.ogKey === ogKey && last.oiKey === oiKey) {
      last.e = e;
      if (last.diff) last.diff.end = new Date(e);
    } else segs.push({ s, e, ogKey, oiKey, diff });
  }
  return segs.filter((x) => x.diff).map((x) => x.diff!);
}
