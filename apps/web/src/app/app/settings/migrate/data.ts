/**
 * What each step of the Opsgenie migration shows, read from the run and from
 * the objects the import created. Every figure on the screen is computed
 * here from real rows; nothing is invented when there is nothing yet — the
 * step says so instead.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  alertPriorities,
  members,
  migrationTeamSwitch,
  shadowDecisions,
  teamMembers,
  withTenant,
  type MigrationStep,
  type Tx,
} from "@openincident/db";
import { decryptSecret, secretHint } from "@openincident/crypto";
import {
  STEP_ORDER,
  activityOf,
  compareSchedule,
  delaysOf,
  describeSchedule,
  glyphOf,
  importCounts,
  importedShapes,
  indexItems,
  integrationTeam,
  latestRun,
  itemsOf,
  linkOf,
  loadSnapshot,
  peopleIndex,
  peopleOf,
  recheck,
  shapeSchedule,
  slotsNote,
  targetOf,
  translationsFor,
  typeLabel,
  unresolved,
  type ArchiveCursor,
  type ItemRow,
  type PersonRow,
  type Run,
  type ScheduleShape,
  type Snapshot,
  type StoredSchedule,
  type TranslationKind,
} from "@openincident/migrate-opsgenie";
import type { Translate } from "@/i18n/server";

export type StepKey = MigrationStep;
export const STEPS: StepKey[] = STEP_ORDER;

/** How far the run got: the index of the first step not done. */
export function reachOf(run: Run | null, ctx: { matchOk: boolean }): number {
  if (!run) return 0;
  if (run.completedAt) return 7;
  const connected =
    Boolean(run.encryptedKey) && Object.values(run.keyChecks ?? {}).every((c) => c.ok);
  if (!connected || Object.keys(run.keyChecks ?? {}).length < 4) return 0;
  if (!run.steps.inventory) return 0;
  if (run.steps.inventory !== "done") return 1;
  if (run.steps.preview !== "done") return ctx.matchOk ? 3 : 2;
  return Math.max(4, STEPS.indexOf(run.step));
}

export type Base = {
  run: Run | null;
  snap: Snapshot | null;
  items: ItemRow[];
  people: PersonRow[];
  orphans: number;
  translations: ReturnType<typeof translationsFor>;
  confirmed: number;
  matchOk: boolean;
  switches: Array<typeof migrationTeamSwitch.$inferSelect>;
  decisions: { total: number; agree: number; open: number; firstAt: Date | null };
  imported: boolean;
};

export async function loadBase(tx: Tx, run: Run | null): Promise<Base> {
  if (!run || run.steps.inventory !== "done")
    return {
      run,
      snap: null,
      items: [],
      people: [],
      orphans: 0,
      translations: [],
      confirmed: 0,
      matchOk: false,
      switches: [],
      decisions: { total: 0, agree: 0, open: 0, firstAt: null },
      imported: false,
    };
  const snap = await loadSnapshot(tx, run);
  const items = await itemsOf(tx, run.id);
  const people = await peopleOf(tx, run.id);
  const orphans = people.filter(unresolved).reduce((n, p) => n + p.futureSlots, 0);
  const translations = translationsFor(snap);
  const confirmed = translations.filter((x) => run.confirmations?.[x.kind]).length;
  const switches = await tx
    .select()
    .from(migrationTeamSwitch)
    .where(eq(migrationTeamSwitch.runId, run.id));
  const [d] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      agree: sql<number>`count(*) filter (where ${shadowDecisions.agrees} or ${shadowDecisions.resolution} is not null)::int`,
      open: sql<number>`count(*) filter (where not ${shadowDecisions.agrees} and ${shadowDecisions.resolution} is null)::int`,
      firstAt: sql<Date | null>`min(${shadowDecisions.receivedAt})`,
    })
    .from(shadowDecisions)
    .where(eq(shadowDecisions.runId, run.id));
  return {
    run,
    snap,
    items,
    people,
    orphans,
    translations,
    confirmed,
    matchOk: orphans === 0 && confirmed === translations.length,
    switches,
    decisions: {
      total: d?.total ?? 0,
      agree: d?.agree ?? 0,
      open: d?.open ?? 0,
      firstAt: d?.firstAt ? new Date(d.firstAt) : null,
    },
    imported: run.steps.preview === "done",
  };
}

const pct = (agree: number, total: number) =>
  total ? Math.floor((agree / total) * 1000) / 10 : 100;

/** "98.9" — one decimal, none when whole. */
export function pctLabel(t: Translate, agree: number, total: number): string {
  const p = pct(agree, total);
  return t.fmt.decimal(p, p === 100 ? 0 : 1);
}

export function shadowDays(run: Run | null, now = new Date()): number {
  const since = run?.shadowStartedAt;
  return since ? Math.max(1, Math.floor((now.getTime() - since.getTime()) / 86_400_000)) : 0;
}

/** The seven lines of the left column. */
export function stepLines(t: Translate, base: Base) {
  const run = base.run;
  const c = run?.counters ?? {};
  const live = base.switches.filter((s) => s.state === "switched").length;
  const cursor = run?.archiveCursor as unknown as ArchiveCursor | null;
  const subs: Record<StepKey, string> = {
    connect: t("migrate.sub.connect"),
    inventory:
      run?.steps.inventory === "done"
        ? t("migrate.sub.inventory", { users: c.users ?? 0, integrations: c.integrations ?? 0 })
        : t("migrate.sub.inventoryNone"),
    people:
      run?.steps.inventory === "done"
        ? t("migrate.sub.people", {
            people: base.people.filter((p) => p.conflict).length,
            translations: base.translations.length,
          })
        : t("migrate.sub.peopleNone"),
    preview: t("migrate.sub.preview"),
    shadow: base.imported
      ? t("migrate.sub.shadow", {
          days: shadowDays(run),
          parity: pctLabel(t, base.decisions.agree, base.decisions.total),
        })
      : t("migrate.sub.shadowNone"),
    switch: base.switches.length
      ? t("migrate.sub.switch", { live, total: base.switches.length })
      : t("migrate.sub.switchNone"),
    archive:
      run?.steps.inventory === "done"
        ? t("migrate.sub.archive", { count: cursor?.total ?? c.alerts ?? 0 })
        : t("migrate.sub.archiveNone"),
  };
  return subs;
}

/* ---------- 1 · Connect ---------- */

export function connectModel(run: Run | null) {
  const key = run?.encryptedKey ? decryptSecret(run.encryptedKey) : null;
  return {
    region: run?.region ?? "eu",
    saved: key ? secretHint(key).slice(-4) : null,
    checks: run?.keyChecks ?? {},
    account: (run?.meta?.account as string | null) ?? null,
    teamsVisible: (run?.meta?.teamsVisible as number | null) ?? null,
  };
}

/* ---------- 2 · Inventory ---------- */

export type IntegrationRow = {
  key: string;
  glyph: string;
  name: string;
  type: string;
  team: string | null;
  status: "live" | "quiet" | "silent";
  last:
    | { kind: "never" }
    | { kind: "at"; at: Date }
    | { kind: "every"; interval: number; unit: string };
  target:
    | { kind: "source"; tool: string }
    | { kind: "genieKey" }
    | { kind: "heartbeat" }
    | { kind: "skip" }
    | { kind: "skipUnless" };
};

export function inventoryModel(base: Base) {
  const snap = base.snap;
  if (!snap) return null;
  const now = new Date(snap.readAt);
  const teamName = new Map(snap.teams.map((t) => [t.id, t.name]));
  const rows: IntegrationRow[] = snap.integrations.map((x) => {
    const status = activityOf(x.lastAlertAt, now);
    const target = targetOf(x.type, status, Boolean(x.lastAlertAt));
    const team = integrationTeam(x);
    return {
      key: x.id,
      glyph: glyphOf(x.type, x.name),
      name: x.name,
      type: typeLabel(x.type),
      team: team ? (teamName.get(team) ?? null) : null,
      status,
      last: x.lastAlertAt ? { kind: "at", at: new Date(x.lastAlertAt) } : { kind: "never" },
      target:
        target.kind === "skip"
          ? { kind: target.label === "skip-unless" ? "skipUnless" : "skip" }
          : target.kind === "heartbeat"
            ? { kind: "heartbeat" }
            : "genieKey" in target && target.genieKey
              ? { kind: "genieKey" }
              : { kind: "source", tool: (target as { tool: string }).tool },
    };
  });
  for (const h of snap.heartbeats)
    rows.push({
      key: `heartbeat:${h.name}`,
      glyph: "Hb",
      name: `Heartbeat — ${h.name}`,
      type: "Heartbeat",
      team: h.ownerTeam?.id ? (teamName.get(h.ownerTeam.id) ?? null) : null,
      status: h.enabled && !h.expired ? "live" : h.enabled ? "quiet" : "silent",
      last: { kind: "every", interval: h.interval, unit: h.intervalUnit },
      target: { kind: "heartbeat" },
    });
  // The design's order: live first, then quiet, then the silent ones.
  const rank = { live: 0, quiet: 1, silent: 2 } as const;
  rows.sort((a, b) => rank[a.status] - rank[b.status]);
  return {
    counters: base.run?.counters ?? {},
    teams: snap.teams.map((t) => t.name),
    heartbeats: snap.heartbeats.map((h) => h.name),
    oldest: snap.alerts.oldest ? new Date(snap.alerts.oldest) : null,
    rows,
  };
}

/* ---------- 3 · People ---------- */

export type PersonView = {
  id: string;
  name: string;
  email: string;
  kind: "matched" | "conflict" | "blocked" | "missing" | "idle";
  resolved: boolean;
  value: string;
  oiName: string | null;
  note: string;
  options: Array<{ value: string; label: string }>;
};

export async function peopleModel(tx: Tx, tenantId: string, t: Translate, base: Base) {
  const snap = base.snap!;
  const ms = await tx
    .select({ id: members.id, name: members.name, email: members.email, status: members.status })
    .from(members)
    .where(eq(members.tenantId, tenantId))
    .orderBy(members.name);
  const usable = ms.filter((m) => m.status !== "disabled");
  const byId = new Map(ms.map((m) => [m.id, m]));
  const list = (names: string[]) => names.join(", ");
  const order = new Map(snap.users.map((u, i) => [u.id, i]));
  const rows: PersonView[] = base.people
    .slice()
    .sort((a, b) => (order.get(a.externalUserId) ?? 0) - (order.get(b.externalUserId) ?? 0))
    .map((p) => {
      const name = p.externalName ?? p.externalEmail ?? p.externalUserId;
      const email = p.externalEmail ?? "";
      const matched = !p.conflict && p.method === "email" && p.memberId;
      const value = p.method === "skip" ? "gap" : p.memberId ? `member:${p.memberId}` : "";
      if (matched)
        return {
          id: p.externalUserId,
          name,
          email,
          kind: "matched",
          resolved: true,
          value,
          oiName: byId.get(p.memberId!)?.name ?? null,
          note: "",
          options: [],
        };
      const schedules = list(slotsNote(snap, p.externalUserId));
      const kind: PersonView["kind"] =
        p.conflict === "different_email"
          ? "conflict"
          : p.conflict === "blocked_but_scheduled"
            ? "blocked"
            : p.conflict === "not_a_member" && p.futureSlots > 0
              ? "missing"
              : "idle";
      const nameMatch = usable.filter(
        (m) => m.name.trim().toLowerCase() === name.trim().toLowerCase(),
      );
      const others = usable.filter((m) => !nameMatch.includes(m));
      const options: PersonView["options"] = [{ value: "", label: t("migrate.people.choose") }];
      if (kind === "conflict") {
        for (const m of [...nameMatch, ...others])
          options.push({
            value: `member:${m.id}`,
            label: t("migrate.people.memberOption", { name: m.name, email: m.email }),
          });
        options.splice(1 + nameMatch.length, 0, {
          value: "invite",
          label: t("migrate.people.invite", { email }),
        });
      } else if (kind === "blocked") {
        for (const m of usable.filter((x) => x.status === "active"))
          options.push({
            value: `member:${m.id}`,
            label: t("migrate.people.hand", { name: m.name }),
          });
        options.push({ value: "gap", label: t("migrate.people.gap") });
      } else {
        options.push({ value: "invite", label: t("migrate.people.invite", { email }) });
        for (const m of usable.filter((x) => x.status === "active"))
          options.push({
            value: `member:${m.id}`,
            label: t("migrate.people.hand", { name: m.name }),
          });
      }
      // An invitation already sent shows as the invited member.
      if (p.method === "invite" && p.memberId)
        options.splice(1, 0, {
          value: `member:${p.memberId}`,
          label: t("migrate.people.invite", { email }),
        });
      const note =
        kind === "conflict"
          ? t("migrate.people.noteConflict", { count: p.futureSlots })
          : kind === "blocked"
            ? t("migrate.people.noteBlocked", { count: p.futureSlots, schedules })
            : kind === "missing"
              ? t("migrate.people.noteMissing", { count: p.futureSlots, schedules })
              : t("migrate.people.noteIdle");
      return {
        id: p.externalUserId,
        name,
        email,
        kind,
        resolved: Boolean(p.method),
        value,
        oiName: null,
        note,
        options,
      };
    });

  // The conversions, each with this account's own example.
  const prios = await tx
    .select()
    .from(alertPriorities)
    .where(eq(alertPriorities.tenantId, tenantId));
  const lowest = prios.slice().sort((a, b) => b.rank - a.rank)[0];
  const translations = base.translations.map((x) => {
    const confirmed = Boolean(base.run?.confirmations?.[x.kind]);
    if (x.kind === "delays") {
      const d = delaysOf(x.escalation);
      return {
        kind: x.kind as TranslationKind,
        confirmed,
        a: t("migrate.tr.delaysA", { name: x.escalation.name, list: d.absolute.join(" · ") }),
        b: t("migrate.tr.delaysB", {
          name: x.escalation.name,
          list: d.relative
            .map((m, i) => (i === 0 ? (m === 0 ? t("migrate.tr.now") : `+${m}`) : `+${m}`))
            .join(" · "),
        }),
      };
    }
    if (x.kind === "layers") {
      const rots = x.schedule.rotations ?? [];
      const top = rots[rots.length - 1]?.name ?? "";
      const lower = rots
        .slice(0, -1)
        .map((r) => r.name)
        .join(", ");
      return {
        kind: x.kind as TranslationKind,
        confirmed,
        a: t("migrate.tr.layersA", { name: x.schedule.name, lower, top }),
        b: t("migrate.tr.layersB", { top, lower }),
      };
    }
    if (x.kind === "p5")
      return {
        kind: x.kind as TranslationKind,
        confirmed,
        a: t("migrate.tr.p5A", { count: x.count }),
        b:
          lowest?.urgency === "low"
            ? t("migrate.tr.p5Quiet", { name: lowest.name })
            : t("migrate.tr.p5Loud", { name: lowest?.name ?? "P4" }),
      };
    const r = x.escalation.repeat!;
    return {
      kind: x.kind as TranslationKind,
      confirmed,
      a: t("migrate.tr.repeatA", { wait: r.waitInterval, count: r.count }),
      b: t("migrate.tr.repeatB", {
        wait: r.waitInterval,
        times: r.count === 2 ? t("migrate.tr.twice") : t("migrate.tr.times", { count: r.count }),
      }),
    };
  });
  return { rows, translations };
}

/* ---------- 4 · Preview ---------- */

export type ScheduleCompare = {
  id: string;
  name: string;
  meta: string;
  count: number;
  fixed: boolean;
  noTimeline: boolean;
  first: {
    start: Date;
    end: Date;
    og: string[];
    oi: string[];
    cause: "pending" | "override" | "lossy";
    partKey: string;
    pendingName: string | null;
    /** The member a one-click fix hands the slot to. */
    hand: { id: string; name: string } | null;
  } | null;
};

function metaOf(t: Translate, s: StoredSchedule): string {
  const d = describeSchedule(s);
  const head =
    d.kind === "layers"
      ? t("migrate.sim.layers", { count: d.count })
      : t("migrate.sim.rotations", { count: d.count });
  const detail: Record<string, string> = {
    "follow-the-sun": t("migrate.sim.followSun"),
    "weekend-on-top": t("migrate.sim.weekendTop"),
    weekly: t("migrate.sim.weekly"),
    daily: t("migrate.sim.daily"),
    weekend: t("migrate.sim.weekend"),
    "business-hours": t("migrate.sim.business"),
    restricted: t("migrate.sim.restricted"),
  };
  return d.detail ? `${head} · ${detail[d.detail]}` : head;
}

export async function previewModel(tx: Tx, tenantId: string, t: Translate, base: Base) {
  const snap = base.snap!;
  const run = base.run!;
  const peopleRows = base.people;
  const people = peopleIndex(peopleRows);
  const ms = await tx
    .select({ id: members.id, name: members.name, status: members.status })
    .from(members)
    .where(eq(members.tenantId, tenantId));
  const active = new Set(ms.filter((m) => m.status === "active").map((m) => m.id));
  const memberName = new Map(ms.map((m) => [m.id, m.name]));
  const names = new Map(snap.users.map((u) => [u.id, u.fullName]));
  const imported = base.imported ? await importedShapes(tx, run.id, people) : null;
  const scheduleItems = indexItems(base.items, "schedule");
  const now = new Date();
  const readAt = new Date(snap.readAt);
  const from = new Date(Math.max(now.getTime(), readAt.getTime()));
  const to = new Date(readAt.getTime() + 56 * 86_400_000);
  const schedules: ScheduleCompare[] = snap.schedules.map((s) => {
    const shape: ScheduleShape = imported?.get(s.id) ?? shapeSchedule(s as StoredSchedule, people);
    const fixes = ((scheduleItems.get(s.id)?.data as { fixes?: unknown[] })?.fixes ?? []).length;
    const noTimeline = !s.timeline?.finalTimeline;
    const diffs = noTimeline
      ? []
      : compareSchedule(s as StoredSchedule, shape, people, active, names, from, to);
    const d = diffs[0];
    let first: ScheduleCompare["first"] = null;
    if (d) {
      const pending = d.og.find((x) => x.memberId && !active.has(x.memberId));
      // Hand the slot to someone of the same rotation who would be paged.
      const candidates = shape.parts
        .flatMap((p) => p.rotations.flatMap((r) => r.memberIds))
        .filter((m) => active.has(m));
      const handId =
        d.cause === "pending"
          ? (candidates.find((m) => m !== pending?.memberId) ?? null)
          : (d.og.find((x) => x.memberId && active.has(x.memberId))?.memberId ?? null);
      first = {
        start: d.start,
        end: d.end,
        og: d.og.map((x) => x.name),
        oi: d.oi.map((m) => memberName.get(m) ?? m),
        cause: d.cause,
        partKey: d.partKey,
        pendingName: pending?.name ?? null,
        hand: handId ? { id: handId, name: memberName.get(handId) ?? handId } : null,
      };
    }
    return {
      id: s.id,
      name: s.name,
      meta: metaOf(t, s as StoredSchedule),
      count: diffs.length,
      fixed: fixes > 0,
      noTimeline,
      first,
    };
  });
  return {
    counts: importCounts(snap, people, Boolean(run.confirmations?.p5)),
    schedules,
    open: schedules.reduce((n, s) => n + s.count, 0),
  };
}

/* ---------- 5 · Shadow ---------- */

export async function shadowModel(tx: Tx, tenantId: string, t: Translate, base: Base) {
  const run = base.run!;
  // A rule or a policy edited since: compare those alerts again.
  if (base.decisions.open) await recheck(tx, tenantId, run);
  const rows = await tx
    .select()
    .from(shadowDecisions)
    .where(eq(shadowDecisions.runId, run.id))
    .orderBy(desc(shadowDecisions.receivedAt));
  const teamName = new Map((base.snap?.teams ?? []).map((x) => [x.id, x.name]));
  const total = rows.length;
  const agree = rows.filter((r) => r.agrees || r.resolution).length;
  const open = total - agree;
  // Escalations started from the imported sources of teams still in shadow: none, by construction — counted anyway.
  const shadowTeams = new Set(
    base.switches.filter((s) => s.state !== "switched").map((s) => s.teamExternalId),
  );
  const shadowSources = base.items
    .filter((i) => i.type === "integration" && i.oiId && shadowTeams.has(linkOf(i)?.team ?? ""))
    .map((i) => i.oiId!);
  let pages = 0;
  if (shadowSources.length) {
    const [p] = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from app.escalations e join app.alerts a on a.id = e.alert_id
           where e.tenant_id = ${tenantId} and a.source_id in (${sql.join(
             shadowSources.map((s) => sql`${s}::uuid`),
             sql`, `,
           )})`,
    );
    pages = Number((p as { n?: number } | undefined)?.n ?? 0);
  }
  const byTeam = new Map<string, { n: number; agree: number; causes: Record<string, number> }>();
  for (const s of base.switches) byTeam.set(s.teamExternalId, { n: 0, agree: 0, causes: {} });
  for (const r of rows) {
    const k = r.teamExternalId ?? "";
    const e = byTeam.get(k) ?? { n: 0, agree: 0, causes: {} };
    e.n += 1;
    if (r.agrees || r.resolution) e.agree += 1;
    else e.causes[r.cause ?? "policy"] = (e.causes[r.cause ?? "policy"] ?? 0) + 1;
    byTeam.set(k, e);
  }
  const parity = [...byTeam.entries()]
    .filter(([k]) => teamName.has(k))
    .map(([k, e]) => ({
      team: teamName.get(k)!,
      n: e.n,
      pct: pct(e.agree, e.n),
      label: pctLabel(t, e.agree, e.n),
      causes: e.causes,
    }));
  const disagreements = rows
    .filter((r) => !r.agrees)
    .sort((a, b) => Number(Boolean(a.resolution)) - Number(Boolean(b.resolution)))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      at: r.receivedAt,
      title: r.alertTitle ?? r.alertExternalId,
      og: r.opsgeniePaged.map((x) => x.name),
      oi: r.oiWouldPage.map((x) => x.name),
      cause: (r.cause ?? "policy") as "override" | "rule" | "policy",
      detail: r.detail as {
        ogRule?: string | null;
        oiRoute?: string | null;
        oiRouteId?: string | null;
        pathId?: string | null;
      },
      resolved: Boolean(r.resolution),
    }));
  return {
    total,
    agree,
    open,
    pages,
    parity,
    disagreements,
    firstAt: rows[rows.length - 1]?.receivedAt ?? null,
  };
}

/* ---------- 6 · Switch ---------- */

export async function switchModel(tx: Tx, tenantId: string, t: Translate, base: Base) {
  const snap = base.snap!;
  const decisions = await tx
    .select({
      team: shadowDecisions.teamExternalId,
      agrees: shadowDecisions.agrees,
      resolution: shadowDecisions.resolution,
    })
    .from(shadowDecisions)
    .where(eq(shadowDecisions.runId, base.run!.id));
  const teamIds = base.switches.map((s) => s.teamId).filter((x): x is string => Boolean(x));
  const tm = teamIds.length
    ? await tx
        .select({ teamId: teamMembers.teamId, n: sql<number>`count(*)::int` })
        .from(teamMembers)
        .where(and(eq(teamMembers.tenantId, tenantId), inArray(teamMembers.teamId, teamIds)))
        .groupBy(teamMembers.teamId)
    : [];
  const owned = (type: ItemRow["type"], team: string) =>
    base.items.filter((i) => i.type === type && linkOf(i)?.team === team);
  const order = new Map(snap.teams.map((x, i) => [x.id, i]));
  return base.switches
    .slice()
    .sort((a, b) => (order.get(a.teamExternalId) ?? 0) - (order.get(b.teamExternalId) ?? 0))
    .map((s) => {
      const mine = decisions.filter((d) => d.team === s.teamExternalId);
      const agree = mine.filter((d) => d.agrees || d.resolution).length;
      const blocked = mine.length - agree;
      const schedules = owned("schedule", s.teamExternalId).reduce(
        (n, i) => n + (linkOf(i)?.parts?.length ?? 0),
        0,
      );
      const policies = owned("escalation", s.teamExternalId).filter((i) => i.oiId).length;
      const integrations = owned("integration", s.teamExternalId).filter((i) => i.oiId).length;
      const checklist =
        (s.checklist as Array<{ key: string; label: string; done: boolean; hint?: string }>) ?? [];
      return {
        id: s.teamExternalId,
        name: snap.teams.find((x) => x.id === s.teamExternalId)?.name ?? s.teamExternalId,
        live: s.state === "switched",
        n: mine.length,
        pct: pct(agree, mine.length),
        label: pctLabel(t, agree, mine.length),
        blocked,
        meta: t("migrate.switch.meta", {
          members: t("migrate.switch.members", {
            count: tm.find((x) => x.teamId === s.teamId)?.n ?? 0,
          }),
          schedules: t("migrate.switch.schedules", { count: schedules }),
          policies: t("migrate.switch.policies", { count: policies }),
          integrations: t("migrate.switch.integrations", { count: integrations }),
        }),
        checklist,
      };
    });
}

/* ---------- 7 · Archive ---------- */

export function archiveModel(base: Base) {
  const run = base.run!;
  const cursor = run.archiveCursor as unknown as ArchiveCursor | null;
  const total = cursor?.total ?? run.counters?.alerts ?? 0;
  const read = cursor ? cursor.windows.reduce((n, w) => n + Math.min(w.offset, w.count), 0) : 0;
  const live = base.switches.filter((s) => s.state === "switched").length;
  return {
    started: run.steps.archive === "running" || run.steps.archive === "done",
    running: run.steps.archive === "running",
    done: run.steps.archive === "done",
    cursor,
    total,
    read,
    pct: total
      ? Math.min(100, Math.floor((read / total) * 100))
      : run.steps.archive === "done"
        ? 100
        : 0,
    imported: cursor?.imported ?? 0,
    open: cursor?.skipped ?? 0,
    oldest: run.meta?.oldestAlertAt ? new Date(run.meta.oldestAlertAt as string) : null,
    pending: base.switches.length - live,
    teams: base.switches.length,
    error: run.error,
    complete: Boolean(run.completedAt),
  };
}

/** Everything the page needs, in one tenant transaction. */
export async function loadRun(tenantId: string) {
  return withTenant(tenantId, (tx) => latestRun(tx, tenantId));
}
