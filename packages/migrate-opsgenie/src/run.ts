/**
 * A migration run in the database: the key, the inventory as read, the
 * people as matched. Every function takes the caller's transaction (opened by
 * `withTenant`), so the screens, the worker and the demo seed share them.
 */
import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@openincident/crypto";
import {
  members,
  migrationItems,
  migrationPeopleMap,
  migrationRuns,
  type MigrationItemType,
  type MigrationStep,
  type MigrationStepState,
  type Tx,
} from "@openincident/db";
import { OpsgenieClient, type ClientOptions } from "./client";
import {
  activityOf,
  detectPrecedence,
  NOBODY_PREFIX,
  type PeopleIndex,
  type StoredSchedule,
} from "./convert";
import {
  futureSlots,
  slotSchedules,
  type KeyChecks,
  type Snapshot,
  type StoredIntegration,
  type StoredTeam,
  type StoredUser,
} from "./inventory";
import type { OgEscalation, OgHeartbeat, OgPolicy, OgRoutingRule, Region } from "./types";

export type Run = typeof migrationRuns.$inferSelect;
export type PersonRow = typeof migrationPeopleMap.$inferSelect;
export type ItemRow = typeof migrationItems.$inferSelect;

export const STEP_ORDER: MigrationStep[] = [
  "connect",
  "inventory",
  "people",
  "preview",
  "shadow",
  "switch",
  "archive",
];

/** The workspace's migration: the latest run. */
export async function latestRun(tx: Tx, tenantId: string): Promise<Run | null> {
  const [run] = await tx
    .select()
    .from(migrationRuns)
    .where(eq(migrationRuns.tenantId, tenantId))
    .orderBy(desc(migrationRuns.createdAt))
    .limit(1);
  return run ?? null;
}

/** A client for the run's key — null when no key is stored or it no longer decrypts. */
export function clientFor(
  run: Pick<Run, "region" | "encryptedKey">,
  opts: Partial<ClientOptions> = {},
): OpsgenieClient | null {
  const key = decryptSecret(run.encryptedKey);
  if (!key) return null;
  return new OpsgenieClient({ region: run.region, key, ...opts });
}

/**
 * Stores a key that passed its checks. The key is encrypted; what comes back
 * to a screen is never more than its last four characters.
 */
export async function saveConnection(
  tx: Tx,
  tenantId: string,
  input: {
    region: Region;
    key: string;
    checks: KeyChecks;
    memberId: string | null;
    account: string | null;
  },
): Promise<Run> {
  const existing = await latestRun(tx, tenantId);
  const keyChecks = Object.fromEntries(
    Object.entries(input.checks).map(([k, v]) => [k, { ok: v.ok, detail: v.detail }]),
  );
  if (existing && !existing.completedAt) {
    const [row] = await tx
      .update(migrationRuns)
      .set({
        region: input.region,
        encryptedKey: encryptSecret(input.key.trim()),
        keyChecks,
        meta: {
          ...existing.meta,
          account: input.account,
          teamsVisible: input.checks.account.teams ?? null,
        },
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(migrationRuns.id, existing.id))
      .returning();
    return row!;
  }
  const [row] = await tx
    .insert(migrationRuns)
    .values({
      tenantId,
      region: input.region,
      encryptedKey: encryptSecret(input.key.trim()),
      keyChecks,
      step: "connect",
      steps: { connect: "done" },
      meta: { account: input.account, teamsVisible: input.checks.account.teams ?? null },
      startedByMemberId: input.memberId,
    })
    .returning();
  return row!;
}

export async function setStep(
  tx: Tx,
  runId: string,
  patch: {
    step?: MigrationStep;
    steps?: Partial<Record<MigrationStep, MigrationStepState>>;
    extra?: Partial<typeof migrationRuns.$inferInsert>;
  },
): Promise<void> {
  const [run] = await tx.select().from(migrationRuns).where(eq(migrationRuns.id, runId));
  if (!run) return;
  const furthest =
    patch.step && STEP_ORDER.indexOf(patch.step) > STEP_ORDER.indexOf(run.step)
      ? patch.step
      : run.step;
  await tx
    .update(migrationRuns)
    .set({
      step: furthest,
      steps: { ...run.steps, ...(patch.steps ?? {}) },
      updatedAt: new Date(),
      ...(patch.extra ?? {}),
    })
    .where(eq(migrationRuns.id, runId));
}

/* ---------- The inventory, item by item ---------- */

type ItemInput = {
  type: MigrationItemType;
  externalId: string;
  name: string | null;
  data: Record<string, unknown>;
  activity?: "live" | "quiet" | "silent" | null;
};

async function upsertItems(
  tx: Tx,
  tenantId: string,
  runId: string,
  items: ItemInput[],
): Promise<void> {
  for (let i = 0; i < items.length; i += 200) {
    const chunk = items.slice(i, i + 200);
    await tx
      .insert(migrationItems)
      .values(chunk.map((x) => ({ tenantId, runId, ...x, activity: x.activity ?? null })))
      .onConflictDoUpdate({
        target: [migrationItems.runId, migrationItems.type, migrationItems.externalId],
        set: {
          name: sql`excluded.name`,
          activity: sql`excluded.activity`,
          // A read keeps what this side added: the slots fixed in the preview,
          // and what the import made of the object.
          data: sql`excluded.data || jsonb_strip_nulls(jsonb_build_object('fixes', coalesce(${migrationItems.data} -> 'fixes', '[]'::jsonb), 'oi', ${migrationItems.data} -> 'oi'))`,
          updatedAt: new Date(),
        },
      });
  }
  // Objects gone from Opsgenie since the last read go too — unless already imported.
  const byType = new Map<MigrationItemType, string[]>();
  for (const x of items) byType.set(x.type, [...(byType.get(x.type) ?? []), x.externalId]);
  for (const type of [
    "user",
    "team",
    "schedule",
    "escalation",
    "routing_rule",
    "policy",
    "integration",
    "heartbeat",
  ] as MigrationItemType[]) {
    const keep = byType.get(type) ?? [];
    await tx
      .delete(migrationItems)
      .where(
        and(
          eq(migrationItems.runId, runId),
          eq(migrationItems.type, type),
          isNull(migrationItems.oiId),
          keep.length ? notInArray(migrationItems.externalId, keep) : sql`true`,
        ),
      );
  }
}

/** Writes what the inventory read, matches the people, and counts. */
export async function storeInventory(
  tx: Tx,
  tenantId: string,
  runId: string,
  snap: Snapshot,
): Promise<void> {
  const now = new Date(snap.readAt);
  const items: ItemInput[] = [];
  for (const u of snap.users)
    items.push({ type: "user", externalId: u.id, name: u.fullName, data: u });
  for (const t of snap.teams) {
    items.push({ type: "team", externalId: t.id, name: t.name, data: t });
    for (const r of t.routingRules)
      items.push({
        type: "routing_rule",
        externalId: r.id,
        name: r.name ?? null,
        data: { ...r, teamId: t.id, teamName: t.name },
      });
  }
  for (const s of snap.schedules)
    items.push({ type: "schedule", externalId: s.id, name: s.name, data: s });
  for (const e of snap.escalations)
    items.push({ type: "escalation", externalId: e.id, name: e.name, data: e });
  for (const p of snap.policies)
    items.push({ type: "policy", externalId: p.id, name: p.name, data: p });
  for (const x of snap.integrations)
    items.push({
      type: "integration",
      externalId: x.id,
      name: x.name,
      data: x,
      activity: activityOf(x.lastAlertAt, now),
    });
  for (const h of snap.heartbeats)
    items.push({
      type: "heartbeat",
      externalId: h.name,
      name: h.name,
      data: h,
      activity: h.enabled && !h.expired ? "live" : h.enabled ? "quiet" : "silent",
    });
  await upsertItems(tx, tenantId, runId, items);
  await matchPeople(tx, tenantId, runId, snap.users, snap.schedules, now);

  const slots = futureSlots(snap.schedules, now);
  const blockedScheduled = snap.users.filter((u) => u.blocked && (slots.get(u.id) ?? 0) > 0).length;
  const integrations = snap.integrations.map((x) => activityOf(x.lastAlertAt, now));
  const counters: Record<string, number> = {
    users: snap.users.length,
    blockedScheduled,
    teams: snap.teams.length,
    schedules: snap.schedules.length,
    rotations: snap.schedules.reduce((n, s) => n + (s.rotations?.length ?? 0), 0),
    overrides: snap.schedules.reduce((n, s) => n + s.overrides.length, 0),
    layered: snap.schedules.filter((s) => detectPrecedence(s.timeline)).length,
    escalations: snap.escalations.length,
    repeating: snap.escalations.filter((e) => e.repeat && e.repeat.count > 0).length,
    routingRules: snap.teams.reduce((n, t) => n + t.routingRules.length, 0),
    integrations: snap.integrations.length,
    live: integrations.filter((x) => x === "live").length,
    quiet: integrations.filter((x) => x === "quiet").length,
    silent: integrations.filter((x) => x === "silent").length,
    heartbeats: snap.heartbeats.length,
    policies: snap.policies.length,
    alerts: snap.alerts.total,
    p5In90d: snap.alerts.p5In90d,
  };
  const [run] = await tx.select().from(migrationRuns).where(eq(migrationRuns.id, runId));
  await tx
    .update(migrationRuns)
    .set({
      counters,
      meta: {
        ...(run?.meta ?? {}),
        account: snap.account ?? run?.meta?.account ?? null,
        oldestAlertAt: snap.alerts.oldest,
      },
      inventoryReadAt: now,
      progress: 100,
      progressLabel: null,
      steps: { ...(run?.steps ?? {}), connect: "done", inventory: "done" },
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(migrationRuns.id, runId));
}

/** The inventory as stored, rebuilt into the shape it was read in. */
export async function loadSnapshot(tx: Tx, run: Run): Promise<Snapshot> {
  const rows = await tx
    .select()
    .from(migrationItems)
    .where(and(eq(migrationItems.runId, run.id), notInArray(migrationItems.type, ["alert"])));
  const of = <T>(type: MigrationItemType) =>
    rows.filter((r) => r.type === type).map((r) => r.data as unknown as T);
  return {
    readAt: (run.inventoryReadAt ?? run.updatedAt).toISOString(),
    account: (run.meta?.account as string | null) ?? null,
    users: of<StoredUser>("user"),
    teams: of<StoredTeam>("team"),
    schedules: of<StoredSchedule & { overrides: []; timeline: null }>("schedule"),
    escalations: of<OgEscalation>("escalation"),
    policies: of<OgPolicy>("policy"),
    integrations: of<StoredIntegration>("integration"),
    heartbeats: of<OgHeartbeat>("heartbeat"),
    alerts: {
      total: run.counters?.alerts ?? 0,
      oldest: (run.meta?.oldestAlertAt as string | null) ?? null,
      p5In90d: run.counters?.p5In90d ?? 0,
    },
  };
}

export async function itemsOf(tx: Tx, runId: string, type?: MigrationItemType): Promise<ItemRow[]> {
  return tx
    .select()
    .from(migrationItems)
    .where(
      type
        ? and(eq(migrationItems.runId, runId), eq(migrationItems.type, type))
        : eq(migrationItems.runId, runId),
    );
}

/* ---------- People ---------- */

export type Conflict = "different_email" | "blocked_but_scheduled" | "not_a_member";

/**
 * Matches every Opsgenie user to a member by email. A blocked user who still
 * holds future slots, a user whose email is not a member's, and a name that
 * matches a member under another email are conflicts to settle by hand. A
 * choice already made survives a new read.
 */
async function matchPeople(
  tx: Tx,
  tenantId: string,
  runId: string,
  users: StoredUser[],
  schedules: Snapshot["schedules"],
  now: Date,
): Promise<void> {
  const ms = await tx
    .select({ id: members.id, email: members.email, name: members.name, status: members.status })
    .from(members)
    .where(eq(members.tenantId, tenantId));
  const existing = await tx
    .select()
    .from(migrationPeopleMap)
    .where(eq(migrationPeopleMap.runId, runId));
  const slots = futureSlots(schedules, now);
  for (const u of users) {
    const email = u.username.toLowerCase();
    const byEmail = ms.find((m) => m.email.toLowerCase() === email && m.status !== "disabled");
    const byName = ms.find(
      (m) =>
        m.name.trim().toLowerCase() === u.fullName.trim().toLowerCase() && m.status !== "disabled",
    );
    const futureSlotsN = slots.get(u.id) ?? 0;
    let conflict: Conflict | null = null;
    if (u.blocked) conflict = futureSlotsN > 0 ? "blocked_but_scheduled" : null;
    else if (!byEmail) conflict = byName ? "different_email" : "not_a_member";
    const prior = existing.find((p) => p.externalUserId === u.id);
    const keepChoice = prior && prior.method && prior.method !== "email";
    const values = {
      tenantId,
      runId,
      externalUserId: u.id,
      externalEmail: u.username,
      externalName: u.fullName,
      blocked: Boolean(u.blocked),
      memberId: keepChoice ? prior.memberId : u.blocked ? null : (byEmail?.id ?? null),
      method: keepChoice ? prior.method : !u.blocked && byEmail ? ("email" as const) : null,
      conflict,
      futureSlots: futureSlotsN,
      updatedAt: new Date(),
    };
    await tx
      .insert(migrationPeopleMap)
      .values(values)
      .onConflictDoUpdate({
        target: [migrationPeopleMap.runId, migrationPeopleMap.externalUserId],
        set: values,
      });
  }
  const ids = users.map((u) => u.id);
  if (ids.length)
    await tx
      .delete(migrationPeopleMap)
      .where(
        and(
          eq(migrationPeopleMap.runId, runId),
          notInArray(migrationPeopleMap.externalUserId, ids),
        ),
      );
}

export async function peopleOf(tx: Tx, runId: string): Promise<PersonRow[]> {
  return tx.select().from(migrationPeopleMap).where(eq(migrationPeopleMap.runId, runId));
}

/** Whether a person still stands between the run and the import. */
export const unresolved = (p: PersonRow) => p.conflict !== null && !p.method;

/** Opsgenie user → the member who takes their slots here, or a "nobody" marker. */
export function peopleIndex(rows: PersonRow[]): PeopleIndex {
  const out: PeopleIndex = new Map();
  for (const p of rows) {
    if (p.method === "skip" || unresolved(p) || !p.memberId)
      out.set(p.externalUserId, `${NOBODY_PREFIX}${p.externalUserId}`);
    else out.set(p.externalUserId, p.memberId);
  }
  return out;
}

/** Settles one person: a member, a fresh invitation (already created), or a flagged gap. */
export async function resolvePerson(
  tx: Tx,
  runId: string,
  externalUserId: string,
  choice:
    | { kind: "member"; memberId: string }
    | { kind: "invite"; memberId: string }
    | { kind: "gap" }
    | { kind: "clear" },
): Promise<void> {
  const set =
    choice.kind === "member"
      ? { memberId: choice.memberId, method: "manual" as const }
      : choice.kind === "invite"
        ? { memberId: choice.memberId, method: "invite" as const }
        : choice.kind === "gap"
          ? { memberId: null, method: "skip" as const }
          : { memberId: null, method: null };
  await tx
    .update(migrationPeopleMap)
    .set({ ...set, updatedAt: new Date() })
    .where(
      and(
        eq(migrationPeopleMap.runId, runId),
        eq(migrationPeopleMap.externalUserId, externalUserId),
      ),
    );
}

/** The schedules a person's future slots sit in (the note under a conflict). */
export function slotsNote(snap: Snapshot, externalUserId: string): string[] {
  return slotSchedules(snap.schedules, externalUserId, new Date(snap.readAt));
}

/* ---------- Conversions to confirm ---------- */

export type TranslationKind = "delays" | "layers" | "p5" | "repeat";

/** The conversions this account needs, each with the example the screen shows. */
export function translationsFor(
  snap: Snapshot,
): Array<
  | { kind: "delays"; escalation: OgEscalation }
  | { kind: "layers"; schedule: Snapshot["schedules"][number] }
  | { kind: "p5"; count: number }
  | { kind: "repeat"; escalation: OgEscalation }
> {
  const out: ReturnType<typeof translationsFor> = [];
  const multi =
    snap.escalations.find((e) => new Set(e.rules.map((r) => r.delay.timeAmount)).size > 2) ??
    snap.escalations.find((e) => new Set(e.rules.map((r) => r.delay.timeAmount)).size > 1);
  if (multi) out.push({ kind: "delays", escalation: multi });
  const layered = snap.schedules.find((s) => detectPrecedence(s.timeline));
  if (layered) out.push({ kind: "layers", schedule: layered });
  const p5Rules = snap.teams.some((t) =>
    t.routingRules.some((r: OgRoutingRule) =>
      (r.criteria.conditions ?? []).some(
        (c) => c.field === "priority" && /p5/i.test(c.expectedValue ?? ""),
      ),
    ),
  );
  if (snap.alerts.p5In90d > 0 || p5Rules) out.push({ kind: "p5", count: snap.alerts.p5In90d });
  const repeating = snap.escalations.find((e) => e.repeat && e.repeat.count > 0);
  if (repeating) out.push({ kind: "repeat", escalation: repeating });
  return out;
}

export async function setConfirmation(
  tx: Tx,
  runId: string,
  kind: TranslationKind,
  value: boolean,
) {
  const [run] = await tx.select().from(migrationRuns).where(eq(migrationRuns.id, runId));
  if (!run) return;
  await tx
    .update(migrationRuns)
    .set({ confirmations: { ...run.confirmations, [kind]: value }, updatedAt: new Date() })
    .where(eq(migrationRuns.id, runId));
}

/** Items by external id, for one type. */
export function indexItems(rows: ItemRow[], type: MigrationItemType): Map<string, ItemRow> {
  return new Map(rows.filter((r) => r.type === type).map((r) => [r.externalId, r]));
}

export async function memberNames(
  tx: Tx,
  tenantId: string,
  ids: string[],
): Promise<Map<string, { name: string; status: string; email: string }>> {
  if (!ids.length) return new Map();
  const rows = await tx
    .select({ id: members.id, name: members.name, status: members.status, email: members.email })
    .from(members)
    .where(and(eq(members.tenantId, tenantId), inArray(members.id, ids)));
  return new Map(rows.map((r) => [r.id, { name: r.name, status: r.status, email: r.email }]));
}
