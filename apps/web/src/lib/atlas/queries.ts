/**
 * Reads of Atlas's state — CONTRACT shared by the engine and the screens.
 *
 * Owner: atlas-core (may extend and optimise; must keep these signatures).
 * Readers: atlas-ui (incident Atlas tab, review queue, service card, insights
 * tab, alert badge, home banner…), Settings › Atlas, and through atlas-ui's
 * components every module. Everything here reads the real tables of
 * packages/db/src/schema/atlas.ts — nothing is simulated: an empty table is
 * an empty answer.
 *
 * Two words the screens use, defined once:
 *  - "resolved by Atlas": Atlas itself resolved the incident (level 3 or 4);
 *    the run then waits for review (investigations.review_state is set);
 *  - "alone": resolved by Atlas with nobody paged (level 4) —
 *    investigations.resolved_alone. At level 3 someone was told.
 */
import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  actionCatalog,
  atlasActions,
  atlasNotifyPrefs,
  atlasSettings,
  autonomyEvents,
  backtests,
  incidents,
  investigations,
  serviceAutonomy,
  services,
  withTenant,
  type AtlasNotifyMode,
} from "@openincident/db";
import { atlas } from "@openincident/investigations";
import { aiConfigured } from "@openincident/ai";
import { effectiveLevel, nextLevelCriteria, progressToNext, readGuardrails } from "./levels";

export type AtlasActionRow = typeof atlasActions.$inferSelect;

export async function getAtlasSettings(tenantId: string) {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select().from(atlasSettings).where(eq(atlasSettings.tenantId, tenantId)).limit(1),
  );
  return row ?? null;
}

export type ServiceAutonomyView = {
  serviceId: string;
  key: string;
  name: string | null;
  level: number;
  cap: number | null;
  effective: number;
  incidentsSeen: number;
  gradedRuns: number;
  rightPct: number | null;
  backtestPct: number | null;
  proposalsOk: number;
  l3FixesOk: number;
  lastMissAt: Date | null;
  /** Right runs graded since the service last went down; null when it never did. */
  rightSinceDrop: number | null;
  changedAt: Date | null;
  reason: string | null;
  next: ReturnType<typeof nextLevelCriteria>;
  /** 0–1, toward the next level (1 at the top). */
  progress: number;
};

function view(
  s: { id: string; key: string; name: string | null },
  a: typeof serviceAutonomy.$inferSelect | null,
): ServiceAutonomyView {
  const base = {
    level: a?.level ?? 0,
    incidentsSeen: a?.incidentsSeen ?? 0,
    gradedRuns: a?.gradedRuns ?? 0,
    rightPct: a?.rightPct ?? null,
    backtestPct: a?.backtestPct ?? null,
    proposalsOk: a?.proposalsOk ?? 0,
    l3FixesOk: a?.l3FixesOk ?? 0,
    lastMissAt: a?.lastMissAt ?? null,
    rightSinceDrop: a?.rightSinceDrop ?? null,
  };
  return {
    serviceId: s.id,
    key: s.key,
    name: s.name,
    ...base,
    cap: a?.cap ?? null,
    effective: effectiveLevel(base.level, a?.cap),
    changedAt: a?.changedAt ?? null,
    reason: a?.reason ?? null,
    next: nextLevelCriteria(base),
    progress: progressToNext(base),
  };
}

/** Every service with its level — a service with no row is at L0. */
export async function listServiceAutonomy(tenantId: string): Promise<ServiceAutonomyView[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        s: { id: services.id, key: services.key, name: services.name },
        a: serviceAutonomy,
      })
      .from(services)
      .leftJoin(serviceAutonomy, eq(serviceAutonomy.serviceId, services.id))
      .where(eq(services.tenantId, tenantId))
      .orderBy(services.key),
  );
  return rows.map((r) => view(r.s, r.a));
}

export async function getServiceAutonomy(
  tenantId: string,
  serviceId: string,
): Promise<ServiceAutonomyView | null> {
  const [r] = await withTenant(tenantId, (tx) =>
    tx
      .select({
        s: { id: services.id, key: services.key, name: services.name },
        a: serviceAutonomy,
      })
      .from(services)
      .leftJoin(serviceAutonomy, eq(serviceAutonomy.serviceId, services.id))
      .where(and(eq(services.tenantId, tenantId), eq(services.id, serviceId)))
      .limit(1),
  );
  return r ? view(r.s, r.a) : null;
}

/** The ladder's history for a service, newest first. */
export async function autonomyHistory(tenantId: string, serviceId: string, limit = 20) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(autonomyEvents)
      .where(and(eq(autonomyEvents.tenantId, tenantId), eq(autonomyEvents.serviceId, serviceId)))
      .orderBy(desc(autonomyEvents.createdAt))
      .limit(limit),
  );
}

/** What Atlas did on an incident, in order. */
export async function listAtlasActions(
  tenantId: string,
  incidentId: string,
): Promise<AtlasActionRow[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(atlasActions)
      .where(and(eq(atlasActions.tenantId, tenantId), eq(atlasActions.incidentId, incidentId)))
      .orderBy(atlasActions.at),
  );
}

/**
 * Incidents Atlas resolved itself since a moment — the home banner ("Atlas
 * resolved N incidents on its own since yesterday"): alone at level 4, and
 * with a person told at level 3.
 */
export async function resolvedAloneSince(tenantId: string, since: Date): Promise<number> {
  const [r] = await withTenant(tenantId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(investigations)
      .innerJoin(incidents, eq(incidents.id, investigations.incidentId))
      .where(
        and(
          eq(investigations.tenantId, tenantId),
          isNotNull(investigations.reviewState),
          gte(incidents.resolvedAt, since),
        ),
      ),
  );
  return r?.n ?? 0;
}

/** Resolutions by Atlas nobody has reviewed yet — the "✦ Resolved by Atlas" tab count. */
export async function reviewCount(tenantId: string): Promise<number> {
  const [r] = await withTenant(tenantId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(investigations)
      .where(and(eq(investigations.tenantId, tenantId), eq(investigations.reviewState, "pending"))),
  );
  return r?.n ?? 0;
}

export type AlertAtlasState =
  | { state: "on_it"; incidentId: string; waiting: AtlasActionRow | null }
  | { state: "alone"; incidentId: string }
  | { state: "told"; incidentId: string; told: string | null };

/**
 * What Atlas is doing about each alert — the "✦ Atlas on it" / "✦ by Atlas
 * alone" / "✦ by Atlas · Thomas told" badges. One query for a whole list.
 * "On it": an open incident whose run is neither paused nor stopped by the
 * kill switch, and whose service Atlas may at least investigate.
 */
export async function alertAtlasStates(
  tenantId: string,
  alertIncidents: Array<{ alertId: string; incidentId: string | null }>,
): Promise<Map<string, AlertAtlasState>> {
  const ids = [...new Set(alertIncidents.map((a) => a.incidentId).filter((x): x is string => !!x))];
  const out = new Map<string, AlertAtlasState>();
  if (ids.length === 0) return out;
  const [invs, waiting, paged, settings] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx
        .select({
          incidentId: investigations.incidentId,
          paused: investigations.paused,
          resolvedAlone: investigations.resolvedAlone,
          reviewState: investigations.reviewState,
          resolvedAt: incidents.resolvedAt,
          phase: incidents.phase,
        })
        .from(investigations)
        .innerJoin(incidents, eq(incidents.id, investigations.incidentId))
        .where(and(eq(investigations.tenantId, tenantId), inArray(investigations.incidentId, ids))),
      tx
        .select()
        .from(atlasActions)
        .where(
          and(
            eq(atlasActions.tenantId, tenantId),
            inArray(atlasActions.incidentId, ids),
            eq(atlasActions.approvalState, "waiting"),
            isNull(atlasActions.undoneAt),
          ),
        ),
      tx
        .select({ incidentId: atlasActions.incidentId, payload: atlasActions.payload })
        .from(atlasActions)
        .where(
          and(
            eq(atlasActions.tenantId, tenantId),
            inArray(atlasActions.incidentId, ids),
            sql`${atlasActions.payload}->'text'->>'key' = 'atlas.j.paged'`,
          ),
        ),
      tx
        .select({ kill: atlasSettings.killSwitch })
        .from(atlasSettings)
        .where(eq(atlasSettings.tenantId, tenantId)),
    ]),
  );
  const killed = settings[0]?.kill ?? false;
  const byIncident = new Map(invs.map((i) => [i.incidentId, i]));
  for (const a of alertIncidents) {
    if (!a.incidentId) continue;
    const inv = byIncident.get(a.incidentId);
    if (!inv) continue;
    if (inv.resolvedAt && inv.reviewState) {
      if (inv.resolvedAlone) out.set(a.alertId, { state: "alone", incidentId: a.incidentId });
      else {
        const p = paged.find((x) => x.incidentId === a.incidentId);
        const params = (p?.payload?.text as { params?: { member?: string } } | undefined)?.params;
        out.set(a.alertId, {
          state: "told",
          incidentId: a.incidentId,
          told: params?.member ?? null,
        });
      }
    } else if (inv.resolvedAt) continue;
    else if (!inv.paused && !killed && (inv.phase === "triage" || inv.phase === "active"))
      out.set(a.alertId, {
        state: "on_it",
        incidentId: a.incidentId,
        waiting: waiting.find((w) => w.incidentId === a.incidentId) ?? null,
      });
  }
  return out;
}

export async function getNotifyMode(tenantId: string, memberId: string): Promise<AtlasNotifyMode> {
  const [r] = await withTenant(tenantId, (tx) =>
    tx
      .select({ mode: atlasNotifyPrefs.mode })
      .from(atlasNotifyPrefs)
      .where(and(eq(atlasNotifyPrefs.tenantId, tenantId), eq(atlasNotifyPrefs.memberId, memberId)))
      .limit(1),
  );
  return r?.mode ?? "summary";
}

/* ---------- Settings › Atlas ---------- */

export type AtlasOverview = {
  killSwitch: boolean;
  killSwitchAt: Date | null;
  killSwitchBy: string | null;
  /** Services where Atlas does anything at all (effective level ≥ 1). */
  acting: number;
  /** Open live incidents Atlas is on: a run, not paused. */
  inProgress: number;
  /** Resolved by Atlas in the last 24 h. */
  resolved24h: number;
  /** Proposals waiting for a person. */
  waiting: number;
};

export async function atlasOverview(tenantId: string): Promise<AtlasOverview> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const [svcs, settings, counts] = await Promise.all([
    listServiceAutonomy(tenantId),
    getAtlasSettings(tenantId),
    withTenant(tenantId, async (tx) => {
      const [p] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(investigations)
        .innerJoin(incidents, eq(incidents.id, investigations.incidentId))
        .where(
          and(
            eq(investigations.tenantId, tenantId),
            eq(investigations.paused, false),
            eq(incidents.mode, "live"),
            inArray(incidents.phase, ["triage", "active"]),
          ),
        );
      const [w] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(atlasActions)
        .where(and(eq(atlasActions.tenantId, tenantId), eq(atlasActions.approvalState, "waiting")));
      return { inProgress: p?.n ?? 0, waiting: w?.n ?? 0 };
    }),
  ]);
  let killSwitchBy: string | null = null;
  if (settings?.killSwitch && settings.killSwitchByMemberId) {
    const { members } = await import("@openincident/db");
    const [m] = await withTenant(tenantId, (tx) =>
      tx
        .select({ name: members.name })
        .from(members)
        .where(eq(members.id, settings.killSwitchByMemberId!)),
    );
    killSwitchBy = m?.name ?? null;
  }
  return {
    killSwitch: settings?.killSwitch ?? false,
    killSwitchAt: settings?.killSwitchAt ?? null,
    killSwitchBy,
    acting: svcs.filter((s) => s.effective >= 1).length,
    inProgress: counts.inProgress,
    resolved24h: await resolvedAloneSince(tenantId, since),
    waiting: counts.waiting,
  };
}

export type AllowedActionView = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  /** A built-in key: the screens translate its label and description. */
  builtIn: boolean;
  executor: string;
  minLevel: number;
  enabled: boolean;
  /** Has a configured way back (undo endpoint), and was not declared irreversible. */
  reversible: boolean;
  /** Declared irreversible: can never be switched on. */
  irreversible: boolean;
  /** Has a do endpoint: it can run on this instance. */
  available: boolean;
  /** The endpoints — admin-configured URLs, never a secret. */
  http: { doUrl: string | null; undoUrl: string | null; verifyUrl: string | null };
  usedOn: number;
};

/** The allowed actions, with what each needs to be usable. The defaults appear on first read. */
export async function listAllowedActions(tenantId: string): Promise<AllowedActionView[]> {
  await atlas.ensureDefaultActions(tenantId);
  const [rows, used] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx
        .select()
        .from(actionCatalog)
        .where(eq(actionCatalog.tenantId, tenantId))
        .orderBy(actionCatalog.minLevel, actionCatalog.createdAt),
      tx
        .select({ key: atlasActions.actionKey, n: sql<number>`count(*)::int` })
        .from(atlasActions)
        .where(
          and(
            eq(atlasActions.tenantId, tenantId),
            eq(atlasActions.kind, "system"),
            isNotNull(atlasActions.executedAt),
          ),
        )
        .groupBy(atlasActions.actionKey),
    ]),
  );
  const order = atlas.DEFAULT_ACTIONS.map((a) => a.key);
  return rows
    .map((a) => {
      const declared = (a.limits as { declared?: boolean }).declared;
      const builtIn = atlas.DEFAULT_ACTION_KEYS.has(a.key);
      const irreversible =
        declared === false ||
        (builtIn && atlas.DEFAULT_ACTIONS.find((d) => d.key === a.key)?.reversible === false);
      return {
        id: a.id,
        key: a.key,
        label: a.label,
        description: a.description,
        builtIn,
        executor: a.executor,
        minLevel: a.minLevel,
        enabled: a.enabled,
        reversible: !irreversible && atlas.isReversible(a),
        irreversible: Boolean(irreversible),
        available: atlas.isAvailable(a),
        http: atlas.httpConfig(a),
        usedOn: used.find((u) => u.key === a.key)?.n ?? 0,
      };
    })
    .sort((x, y) => {
      const ix = order.indexOf(x.key);
      const iy = order.indexOf(y.key);
      return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy) || x.label.localeCompare(y.label);
    });
}

export type BudgetView = {
  spentEur: number;
  tokens: number;
  monthEur: number | null;
  perRunEur: number | null;
  medianRunEur: number | null;
  runs: number;
  exhausted: boolean;
};

/** This month's spend from the rows (runs and backtests), the limits, the median run. */
export async function atlasBudget(tenantId: string): Promise<BudgetView> {
  return withTenant(tenantId, async (tx) => {
    const settings = await atlas.readSettingsTx(tx, tenantId);
    const spend = await atlas.monthSpendTx(tx, tenantId);
    return {
      spentEur: spend.eur,
      tokens: spend.tokens,
      monthEur: settings.budgetMonthEur,
      perRunEur: settings.capPerRunEur,
      medianRunEur: atlas.median(spend.runs),
      runs: spend.runs.length,
      exhausted: settings.budgetMonthEur != null && spend.eur >= settings.budgetMonthEur,
    };
  });
}

export type BacktestView = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  incidents: number;
  done: number;
  grades: { bullseye: number; on_target: number; miss: number; nowhere_near: number };
  rightPct: number | null;
  resolvedAlone: number | null;
  medianMinutesSooner: number | null;
  costEur: number;
  error: string | null;
  runAt: Date;
  completedAt: Date | null;
};

/** The latest backtest, and the latest completed one (shown while a new one runs). */
export async function atlasBacktests(
  tenantId: string,
): Promise<{ latest: BacktestView | null; completed: BacktestView | null; available: boolean }> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(backtests)
      .where(eq(backtests.tenantId, tenantId))
      .orderBy(desc(backtests.runAt))
      .limit(10),
  );
  const toView = (b: (typeof rows)[number]): BacktestView => {
    const g = {
      bullseye: b.grades.bullseye ?? 0,
      on_target: b.grades.on_target ?? 0,
      miss: b.grades.miss ?? 0,
      nowhere_near: b.grades.nowhere_near ?? 0,
    };
    const total = g.bullseye + g.on_target + g.miss + g.nowhere_near;
    return {
      id: b.id,
      status: b.status,
      incidents: b.incidents,
      done: b.stats?.done ?? (b.status === "completed" ? b.incidents : 0),
      grades: g,
      rightPct: total ? Math.round(((g.bullseye + g.on_target) / total) * 100) : null,
      resolvedAlone: b.stats?.resolvedAlone ?? null,
      medianMinutesSooner: b.stats?.medianMinutesSooner ?? null,
      costEur: b.costEur,
      error: b.error,
      runAt: b.runAt,
      completedAt: b.completedAt,
    };
  };
  const latest = rows[0] ? toView(rows[0]) : null;
  const completed = rows.find((r) => r.status === "completed");
  return {
    latest,
    completed: completed ? toView(completed) : null,
    available: aiConfigured(),
  };
}

/** The guardrails as stored, read defensively. */
export async function atlasGuardrails(tenantId: string) {
  const s = await getAtlasSettings(tenantId);
  return readGuardrails(s?.guardrails);
}

/** The run of an incident, if any — for the screens that need its review state or cost. */
export async function investigationOf(tenantId: string, incidentId: string) {
  const [r] = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(investigations)
      .where(and(eq(investigations.tenantId, tenantId), eq(investigations.incidentId, incidentId))),
  );
  return r ?? null;
}
