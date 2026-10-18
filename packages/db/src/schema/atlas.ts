/**
 * Atlas — autonomy earned per service (design V2, spec delta §15).
 *
 * Atlas starts every service at level 0 and climbs one level at a time on
 * graded evidence: runs graded after closure, a backtest over past incidents,
 * proposals approved unchanged, fixes never undone. It falls back on its own
 * — an undo or a Miss costs a level, a reopen or a "nowhere near" sends it
 * back to level 1 — and an admin can only cap a level, never raise one.
 *
 *   L0 Observe       reads, says nothing unless asked
 *   L1 Investigate   investigates, findings, drafts
 *   L2 Propose       prepares a fix from the action catalog; one-tap approval
 *   L3 Act & tell    runs reversible actions at once AND pages at the same time
 *   L4 Resolve       resolves end to end, tells afterwards, undo for 24 h
 *
 * Nothing here executes anything: these tables are the state the engine reads
 * and the journal it writes, so that every screen that shows what Atlas did
 * reads one record of it.
 */
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { app, incidents, investigations, members, services } from "./app";
import { tenants } from "./directory";

const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;
export type AutonomyCause = "grade" | "undo" | "reopen" | "cap" | "promotion" | "backtest";

/** Where a service stands, and the evidence the next level is measured on. */
export const serviceAutonomy = app.table(
  "service_autonomy",
  {
    tenantId: tenantId(),
    serviceId: uuid("service_id")
      .primaryKey()
      .references(() => services.id, { onDelete: "cascade" }),
    level: integer("level").$type<AutonomyLevel>().notNull().default(0),
    /** An admin's ceiling. The effective level is min(level, cap). Null: no cap. */
    cap: integer("cap").$type<AutonomyLevel | null>(),
    /** Incidents Atlas has seen on this service — the L1 criterion. */
    incidentsSeen: integer("incidents_seen").notNull().default(0),
    gradedRuns: integer("graded_runs").notNull().default(0),
    /** Share of graded runs graded bullseye or on target, 0–100. */
    rightPct: doublePrecision("right_pct"),
    /** Share of the backtest's replays graded right, 0–100. Null: never backtested. */
    backtestPct: doublePrecision("backtest_pct"),
    /** Proposals approved without a change — the L3 criterion. */
    proposalsOk: integer("proposals_ok").notNull().default(0),
    /** Fixes run at L3 and never undone — the L4 criterion. */
    l3FixesOk: integer("l3_fixes_ok").notNull().default(0),
    lastMissAt: timestamp("last_miss_at", { withTimezone: true }),
    changedAt: timestamp("changed_at", { withTimezone: true }),
    reason: text("reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Right runs graded since the service last went down; null when it never did. */
    rightSinceDrop: integer("right_since_drop"),
  },
  (t) => [index("service_autonomy_tenant").on(t.tenantId)],
);

/** Every change of level, with its cause — the audit of the ladder. */
export const autonomyEvents = app.table(
  "autonomy_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    fromLevel: integer("from_level").notNull(),
    toLevel: integer("to_level").notNull(),
    cause: text("cause").$type<AutonomyCause>().notNull(),
    byMemberId: uuid("by_member_id").references(() => members.id, { onDelete: "set null" }),
    investigationId: uuid("investigation_id").references(() => investigations.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("autonomy_events_service").on(t.tenantId, t.serviceId, t.createdAt)],
);

export type ActionExecutor = "open-incident" | "open-change" | "kubernetes" | "flags" | "runbook";

/**
 * What Atlas may do on a system — and nothing outside it. An irreversible
 * action can be listed (so a person sees it proposed) but never enabled for
 * autonomous use.
 */
export const actionCatalog = app.table(
  "action_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    executor: text("executor").$type<ActionExecutor>().notNull(),
    reversible: boolean("reversible").notNull().default(true),
    /** The lowest level allowed to run it without a person. */
    minLevel: integer("min_level").$type<AutonomyLevel>().notNull().default(3),
    enabled: boolean("enabled").notNull().default(false),
    /** Executor-specific bounds: max replicas, allowed namespaces, flag keys… */
    limits: jsonb("limits").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("action_catalog_key").on(t.tenantId, t.key)],
);

export type AtlasActionKind = "read" | "oi_write" | "system" | "human";
export type AtlasApprovalState = "none" | "waiting" | "approved" | "rejected" | "withdrawn";

/**
 * What Atlas did, one row per step, in order — the journal every screen reads:
 * the incident's Atlas tab, the timeline, the review queue, the audit log, the
 * post-mortem's "What Atlas did".
 */
export const atlasActions = app.table(
  "atlas_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    investigationId: uuid("investigation_id").references(() => investigations.id, {
      onDelete: "cascade",
    }),
    incidentId: uuid("incident_id").references(() => incidents.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").$type<AtlasActionKind>().notNull(),
    /** The catalog entry, for a system action. */
    actionKey: text("action_key"),
    /** What — one line. */
    title: text("title").notNull(),
    /** How — the query, the command, the change. */
    detail: text("detail"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** "atlas", or the member who did it (kind "human"). */
    decidedBy: text("decided_by").$type<"atlas" | "member">().notNull().default("atlas"),
    decidedByMemberId: uuid("decided_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    /** The effective level when it was decided. */
    level: integer("level").$type<AutonomyLevel>(),
    /** Taken without a person — the "autonomous" chip and the "by Atlas alone" line. */
    autonomous: boolean("autonomous").notNull().default(false),
    approvalState: text("approval_state").$type<AtlasApprovalState>().notNull().default("none"),
    approvalRequestedAt: timestamp("approval_requested_at", { withTimezone: true }),
    approvedByMemberId: uuid("approved_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    reversible: boolean("reversible").notNull().default(false),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneByMemberId: uuid("undone_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    redoneAt: timestamp("redone_at", { withTimezone: true }),
    costEur: doublePrecision("cost_eur").notNull().default(0),
    tokens: integer("tokens").notNull().default(0),
    /** The sources it read or cites, as evidence ids of the investigation. */
    sources: jsonb("sources").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    index("atlas_actions_investigation").on(t.tenantId, t.investigationId, t.at),
    index("atlas_actions_incident").on(t.tenantId, t.incidentId, t.at),
  ],
);

export type AtlasGuardrails = {
  sev1: boolean;
  securityAndPrivate: boolean;
  firstUseOnService: boolean;
  changeFreeze: boolean;
  publicStatusPage: boolean;
  /** Locked on: nothing outside the catalog. Stored for the record, never off. */
  catalogOnly: true;
};

/** The workspace's switches: the kill switch, the guardrails, the budget. */
export const atlasSettings = app.table("atlas_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  killSwitch: boolean("kill_switch").notNull().default(false),
  killSwitchAt: timestamp("kill_switch_at", { withTimezone: true }),
  killSwitchByMemberId: uuid("kill_switch_by_member_id").references(() => members.id, {
    onDelete: "set null",
  }),
  guardrails: jsonb("guardrails").$type<AtlasGuardrails>().notNull().default({
    sev1: true,
    securityAndPrivate: true,
    firstUseOnService: true,
    changeFreeze: true,
    publicStatusPage: true,
    catalogOnly: true,
  }),
  budgetMonthEur: doublePrecision("budget_month_eur"),
  capPerRunEur: doublePrecision("cap_per_run_eur"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  /** Salt of the automation signing secret (derived, never stored). Rotating it rotates the secret. */
  executorNonce: text("executor_nonce"),
});

export type AtlasNotifyMode = "push" | "summary" | "nothing";

/** "When Atlas resolves on its own" — per member. Absent: the 09:00 summary. */
export const atlasNotifyPrefs = app.table(
  "atlas_notify_prefs",
  {
    tenantId: tenantId(),
    memberId: uuid("member_id")
      .primaryKey()
      .references(() => members.id, { onDelete: "cascade" }),
    mode: text("mode").$type<AtlasNotifyMode>().notNull().default("summary"),
    updatedAt: updatedAt(),
    /** When the 09:00 summary last went out to this member. */
    lastSummaryAt: timestamp("last_summary_at", { withTimezone: true }),
  },
  (t) => [index("atlas_notify_prefs_tenant").on(t.tenantId)],
);

export type BacktestStats = {
  replayed?: number;
  resolvedAlone?: number;
  medianMinutesSooner?: number | null;
  perService?: Record<string, { incidents: number; right: number }>;
  /** Progress while running: incidents done so far. */
  done?: number;
};

/** A replay of past incidents against today's Atlas, graded like a real run. */
export const backtests = app.table(
  "backtests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<"queued" | "running" | "completed" | "failed">()
      .notNull()
      .default("queued"),
    windowDays: integer("window_days").notNull().default(90),
    incidents: integer("incidents").notNull().default(0),
    /** { bullseye, on_target, miss, nowhere_near } counts. */
    grades: jsonb("grades").$type<Record<string, number>>().notNull().default({}),
    costEur: doublePrecision("cost_eur").notNull().default(0),
    error: text("error"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /**
     * What the replay found besides the grades: { resolvedAlone, medianMinutesSooner,
     * replayed, perService: { [serviceId]: { incidents, right } } }.
     */
    stats: jsonb("stats").$type<BacktestStats>().notNull().default({}),
  },
  (t) => [index("backtests_tenant").on(t.tenantId, t.runAt)],
);
