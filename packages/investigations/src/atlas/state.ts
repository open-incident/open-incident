/**
 * What the engine reads before deciding: the incident and its service, the
 * service's level and cap, the workspace's switches, the rule's directive,
 * the allowed actions, and the facts the guardrails are checked against.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import {
  actionCatalog,
  alertRoutes,
  alerts,
  atlasActions,
  atlasSettings,
  changeEvents,
  incidentTypes,
  incidents,
  investigations,
  serviceAutonomy,
  services,
  severities,
  withTenant,
  type Tx,
} from "@openincident/db";
import { readGuardrails, type Guardrails } from "./rules";
import { newExecutorNonce } from "./sign";
import type { ActionRow } from "./executors";
import { DEFAULT_ACTIONS } from "./defaults";

export type AtlasSettingsView = {
  killSwitch: boolean;
  killSwitchAt: Date | null;
  guardrails: Guardrails;
  budgetMonthEur: number | null;
  capPerRunEur: number | null;
  executorNonce: string;
};

/** The workspace's switches; a workspace that never opened the screen gets the defaults. */
export async function readSettingsTx(tx: Tx, tenantId: string): Promise<AtlasSettingsView> {
  const [row] = await tx
    .select()
    .from(atlasSettings)
    .where(eq(atlasSettings.tenantId, tenantId))
    .limit(1);
  let nonce = row?.executorNonce ?? null;
  if (!nonce) {
    // The salt is created the first time anything needs the automation secret.
    nonce = newExecutorNonce();
    await tx
      .insert(atlasSettings)
      .values({ tenantId, executorNonce: nonce })
      .onConflictDoUpdate({
        target: atlasSettings.tenantId,
        set: { executorNonce: sql`coalesce(${atlasSettings.executorNonce}, ${nonce})` },
      });
    const [again] = await tx
      .select({ n: atlasSettings.executorNonce })
      .from(atlasSettings)
      .where(eq(atlasSettings.tenantId, tenantId));
    nonce = again?.n ?? nonce;
  }
  return {
    killSwitch: row?.killSwitch ?? false,
    killSwitchAt: row?.killSwitchAt ?? null,
    guardrails: readGuardrails(row?.guardrails),
    budgetMonthEur: row?.budgetMonthEur ?? null,
    capPerRunEur: row?.capPerRunEur ?? null,
    executorNonce: nonce,
  };
}

export async function readSettings(tenantId: string): Promise<AtlasSettingsView> {
  return withTenant(tenantId, (tx) => readSettingsTx(tx, tenantId));
}

export type IncidentFacts = {
  id: string;
  number: number;
  name: string;
  phase: string;
  mode: string;
  visibility: string;
  serviceId: string | null;
  serviceKey: string | null;
  ownerTeamId: string | null;
  severity: string | null;
  severityRank: number | null;
  acknowledgedAt: Date | null;
  declaredAt: Date;
  resolvedAt: Date | null;
  privateType: boolean;
};

export async function incidentFactsTx(
  tx: Tx,
  tenantId: string,
  incidentId: string,
): Promise<IncidentFacts | null> {
  const [r] = await tx
    .select({
      inc: incidents,
      serviceKey: services.key,
      ownerTeamId: services.ownerTeamId,
      sev: severities.name,
      rank: severities.rank,
      privateType: incidentTypes.privateByDefault,
    })
    .from(incidents)
    .leftJoin(services, eq(services.id, incidents.serviceId))
    .leftJoin(severities, eq(severities.id, incidents.severityId))
    .leftJoin(incidentTypes, eq(incidentTypes.id, incidents.typeId))
    .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)))
    .limit(1);
  if (!r) return null;
  return {
    id: r.inc.id,
    number: r.inc.number,
    name: r.inc.name,
    phase: r.inc.phase,
    mode: r.inc.mode,
    visibility: r.inc.visibility,
    serviceId: r.inc.serviceId,
    serviceKey: r.serviceKey ?? null,
    ownerTeamId: r.ownerTeamId ?? null,
    severity: r.sev ?? null,
    severityRank: r.rank ?? null,
    acknowledgedAt: r.inc.acknowledgedAt,
    declaredAt: r.inc.declaredAt,
    resolvedAt: r.inc.resolvedAt,
    privateType: Boolean(r.privateType),
  };
}

/** The level and the cap of a service; a service with no row is at L0, uncapped. */
export async function autonomyOfTx(
  tx: Tx,
  tenantId: string,
  serviceId: string | null,
): Promise<{ level: number; cap: number | null }> {
  if (!serviceId) return { level: 0, cap: null };
  const [a] = await tx
    .select({ level: serviceAutonomy.level, cap: serviceAutonomy.cap })
    .from(serviceAutonomy)
    .where(and(eq(serviceAutonomy.tenantId, tenantId), eq(serviceAutonomy.serviceId, serviceId)));
  return { level: a?.level ?? 0, cap: a?.cap ?? null };
}

/**
 * The rule's word on Atlas for this incident: "never" on any of its alerts'
 * rules wins; otherwise "handle" if one says so; otherwise nothing.
 */
export async function directiveOfTx(
  tx: Tx,
  tenantId: string,
  incidentId: string,
): Promise<"handle" | "never" | null> {
  const rows = await tx
    .select({ d: alertRoutes.atlasDirective })
    .from(alerts)
    .innerJoin(alertRoutes, eq(alertRoutes.id, alerts.routeId))
    .where(and(eq(alerts.tenantId, tenantId), eq(alerts.incidentId, incidentId)));
  if (rows.some((r) => r.d === "never")) return "never";
  if (rows.some((r) => r.d === "handle")) return "handle";
  return null;
}

/** The directive a rule gives a service's alerts, before any incident exists. */
export async function directiveOfRouteTx(
  tx: Tx,
  tenantId: string,
  routeId: string | null,
): Promise<"handle" | "never" | null> {
  if (!routeId) return null;
  const [r] = await tx
    .select({ d: alertRoutes.atlasDirective })
    .from(alertRoutes)
    .where(and(eq(alertRoutes.tenantId, tenantId), eq(alertRoutes.id, routeId)));
  return r?.d ?? null;
}

/** The allowed actions in the order the screen lists them: the built-ins first, as designed. */
export async function listActionsTx(tx: Tx, tenantId: string): Promise<ActionRow[]> {
  const rows = await tx
    .select()
    .from(actionCatalog)
    .where(eq(actionCatalog.tenantId, tenantId))
    .orderBy(actionCatalog.minLevel, actionCatalog.createdAt);
  const order = DEFAULT_ACTIONS.map((a) => a.key);
  const rank = (k: string) => (order.indexOf(k) < 0 ? 99 : order.indexOf(k));
  return rows.sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
}

/** Never run on this service before — with a person or without. */
export async function firstUseOnServiceTx(
  tx: Tx,
  tenantId: string,
  serviceId: string | null,
  actionKey: string,
): Promise<boolean> {
  if (!serviceId) return true;
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(atlasActions)
    .where(
      and(
        eq(atlasActions.tenantId, tenantId),
        eq(atlasActions.serviceId, serviceId),
        eq(atlasActions.actionKey, actionKey),
        eq(atlasActions.kind, "system"),
        isNotNull(atlasActions.executedAt),
      ),
    );
  return (r?.n ?? 0) === 0;
}

/**
 * A change freeze in force for the service: a change event (kind "other",
 * from the change tooling, through the API) whose payload carries
 * `freeze_until` in the future, for this service or for every service.
 */
export async function changeFreezeTx(
  tx: Tx,
  tenantId: string,
  serviceId: string | null,
  now = new Date(),
): Promise<boolean> {
  const rows = await tx
    .select({ payload: changeEvents.payload })
    .from(changeEvents)
    .where(
      and(
        eq(changeEvents.tenantId, tenantId),
        lte(changeEvents.occurredAt, now),
        gte(changeEvents.occurredAt, new Date(now.getTime() - 30 * 86_400_000)),
        sql`${changeEvents.payload} ? 'freeze_until'`,
        serviceId
          ? or(eq(changeEvents.serviceId, serviceId), isNull(changeEvents.serviceId))
          : isNull(changeEvents.serviceId),
      ),
    )
    .orderBy(desc(changeEvents.occurredAt))
    .limit(20);
  return rows.some((r) => {
    const until = Date.parse(String((r.payload as Record<string, unknown>).freeze_until ?? ""));
    return Number.isFinite(until) && until > now.getTime();
  });
}

/** Proposals still waiting, and actions run and not undone, on an incident. */
export async function liveActionsTx(tx: Tx, tenantId: string, incidentId: string) {
  return tx
    .select()
    .from(atlasActions)
    .where(
      and(
        eq(atlasActions.tenantId, tenantId),
        eq(atlasActions.incidentId, incidentId),
        eq(atlasActions.kind, "system"),
        or(
          eq(atlasActions.approvalState, "waiting"),
          and(isNotNull(atlasActions.executedAt), isNull(atlasActions.undoneAt)),
        ),
      ),
    );
}

/** System actions ever tried on an incident — the engine proposes at most two per incident. */
export async function systemAttemptsTx(tx: Tx, tenantId: string, incidentId: string) {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(atlasActions)
    .where(
      and(
        eq(atlasActions.tenantId, tenantId),
        eq(atlasActions.incidentId, incidentId),
        eq(atlasActions.kind, "system"),
      ),
    );
  return r?.n ?? 0;
}

/* ---------- Budget ---------- */

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Spent this calendar month: every run and every backtest, from their rows. */
export async function monthSpendTx(
  tx: Tx,
  tenantId: string,
  now = new Date(),
): Promise<{ eur: number; tokens: number; runs: number[] }> {
  const from = monthStart(now);
  const rows = await tx
    .select({ cost: investigations.costEur, tokens: investigations.tokensTotal })
    .from(investigations)
    .where(
      and(
        eq(investigations.tenantId, tenantId),
        sql`coalesce(${investigations.startedAt}, ${investigations.createdAt}) >= ${from.toISOString()}::timestamptz`,
      ),
    );
  const [bt] = (await tx
    .execute(
      sql`
    select coalesce(sum(cost_eur), 0)::float as eur from app.backtests
    where tenant_id = ${tenantId} and run_at >= ${from.toISOString()}::timestamptz
  `,
    )
    .then((r) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])))) as Array<{
    eur: number;
  }>;
  const eur = rows.reduce((s, r) => s + (r.cost ?? 0), 0) + Number(bt?.eur ?? 0);
  return {
    eur,
    tokens: rows.reduce((s, r) => s + (r.tokens ?? 0), 0),
    runs: rows.map((r) => r.cost ?? 0).filter((c) => c > 0),
  };
}

export type BudgetState = {
  spentEur: number;
  monthEur: number | null;
  exhausted: boolean;
};

export async function budgetStateTx(tx: Tx, tenantId: string, s: AtlasSettingsView) {
  const spend = await monthSpendTx(tx, tenantId);
  return {
    spentEur: spend.eur,
    monthEur: s.budgetMonthEur,
    exhausted: s.budgetMonthEur != null && spend.eur >= s.budgetMonthEur,
  } satisfies BudgetState;
}

/** Incident ids among `ids` that already had a run — in progress, so allowed to finish. */
export async function incidentsWithRunsTx(tx: Tx, tenantId: string, ids: string[]) {
  if (ids.length === 0) return new Set<string>();
  const rows = await tx
    .select({ id: investigations.incidentId })
    .from(investigations)
    .where(
      and(
        eq(investigations.tenantId, tenantId),
        inArray(investigations.incidentId, ids),
        sql`${investigations.runs} > 0`,
      ),
    );
  return new Set(rows.map((r) => r.id));
}
