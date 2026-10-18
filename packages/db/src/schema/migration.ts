/**
 * Moving a workspace off Opsgenie (design V2, spec delta §14).
 *
 * A run reads the Opsgenie account with a global key, imports what it read
 * INACTIVE, measures in shadow mode who Open Incident would have paged for
 * each alert Opsgenie forwarded, then switches team by team — each switch is
 * the activation of that team's rules and policies, and can be rolled back.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { app, members, teams } from "./app";
import { tenants } from "./directory";

const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export type MigrationStep =
  "connect" | "inventory" | "people" | "preview" | "shadow" | "switch" | "archive";
export type MigrationStepState = "todo" | "running" | "blocked" | "done";

export const migrationRuns = app.table(
  "migration_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    provider: text("provider").$type<"opsgenie">().notNull().default("opsgenie"),
    region: text("region").$type<"eu" | "us">().notNull().default("eu"),
    /** The global API key, encrypted at rest with ENCRYPTION_KEY. Never sent back. */
    encryptedKey: text("encrypted_key"),
    /** Reachable, Read, Configuration Access, account (not team) key — as last checked. */
    keyChecks: jsonb("key_checks")
      .$type<Record<string, { ok: boolean; detail?: string }>>()
      .notNull()
      .default({}),
    step: text("step").$type<MigrationStep>().notNull().default("connect"),
    steps: jsonb("steps")
      .$type<Partial<Record<MigrationStep, MigrationStepState>>>()
      .notNull()
      .default({}),
    /** Inventory counters: users, teams, schedules, escalations, integrations… */
    counters: jsonb("counters").$type<Record<string, number>>().notNull().default({}),
    /** Progress of a background read, 0–100, and what it is reading. */
    progress: integer("progress").notNull().default(0),
    progressLabel: text("progress_label"),
    /** Hash of the shadow-mode webhook token (/in/opsgenie/:token). */
    shadowTokenHash: text("shadow_token_hash"),
    archiveCursor: jsonb("archive_cursor").$type<Record<string, unknown> | null>(),
    error: text("error"),
    startedByMemberId: uuid("started_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Background work (inventory, archive) holds this lease; an expired one is resumed. */
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    /** The shadow webhook token, encrypted: the URL is shown again to administrators. */
    shadowTokenEncrypted: text("shadow_token_encrypted"),
    shadowStartedAt: timestamp("shadow_started_at", { withTimezone: true }),
    inventoryReadAt: timestamp("inventory_read_at", { withTimezone: true }),
    /** Conversions confirmed side by side: delays, layers, p5, repeat. */
    confirmations: jsonb("confirmations").$type<Record<string, boolean>>().notNull().default({}),
    /** Account facts read with the key: name, oldest alert, P5 volume. */
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("migration_runs_tenant").on(t.tenantId)],
);

export type MigrationItemType =
  | "user"
  | "team"
  | "schedule"
  | "escalation"
  | "routing_rule"
  | "notification_rule"
  | "policy"
  | "integration"
  | "heartbeat"
  | "alert";
export type MigrationItemStatus = "read" | "planned" | "created" | "skipped" | "conflict" | "error";

/** One Opsgenie object, what it became here, and anything in the way. */
export const migrationItems = app.table(
  "migration_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    runId: uuid("run_id")
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "cascade" }),
    type: text("type").$type<MigrationItemType>().notNull(),
    externalId: text("external_id").notNull(),
    name: text("name"),
    /** The Open Incident row it became, and which table it lives in. */
    oiId: uuid("oi_id"),
    oiTable: text("oi_table"),
    status: text("status").$type<MigrationItemStatus>().notNull().default("read"),
    /** For an integration: live / quiet / no alert in 90 days. */
    activity: text("activity").$type<"live" | "quiet" | "silent" | null>(),
    conflict: jsonb("conflict").$type<Record<string, unknown> | null>(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("migration_items_external").on(t.runId, t.type, t.externalId),
    index("migration_items_tenant").on(t.tenantId, t.runId, t.type),
  ],
);

/** Who an Opsgenie user is here. */
export const migrationPeopleMap = app.table(
  "migration_people_map",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    runId: uuid("run_id")
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "cascade" }),
    externalUserId: text("external_user_id").notNull(),
    externalEmail: text("external_email"),
    externalName: text("external_name"),
    blocked: boolean("blocked").notNull().default(false),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    method: text("method").$type<"email" | "manual" | "invite" | "skip" | null>(),
    /** different_email, blocked_but_scheduled, not_a_member — null once resolved. */
    conflict: text("conflict"),
    /** Future on-call slots this person holds; an orphan blocks the next step. */
    futureSlots: integer("future_slots").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("migration_people_map_user").on(t.runId, t.externalUserId)],
);

/** For one alert Opsgenie forwarded: who it paged, who we would have. */
export const shadowDecisions = app.table(
  "shadow_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    runId: uuid("run_id")
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "cascade" }),
    alertExternalId: text("alert_external_id").notNull(),
    alertTitle: text("alert_title"),
    teamExternalId: text("team_external_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    opsgeniePaged: jsonb("opsgenie_paged")
      .$type<Array<{ id?: string; name: string }>>()
      .notNull()
      .default([]),
    oiWouldPage: jsonb("oi_would_page")
      .$type<Array<{ memberId?: string; name: string }>>()
      .notNull()
      .default([]),
    agrees: boolean("agrees").notNull().default(true),
    /** How a disagreement was settled: fixed_here, opsgenie_wrong, ignored. */
    resolution: text("resolution"),
    resolvedByMemberId: uuid("resolved_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** Why they disagreed: override (read after the last inventory), rule, policy. */
    cause: text("cause"),
    /** The alert as read and the rule each side applied — enough to compare again. */
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    uniqueIndex("shadow_decisions_alert").on(t.runId, t.alertExternalId),
    index("shadow_decisions_tenant").on(t.tenantId, t.runId, t.receivedAt),
  ],
);

/** A team's switch from Opsgenie to Open Incident, and its rollback. */
export const migrationTeamSwitch = app.table(
  "migration_team_switch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    runId: uuid("run_id")
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "cascade" }),
    teamExternalId: text("team_external_id").notNull(),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    state: text("state")
      .$type<"pending" | "switched" | "rolled_back">()
      .notNull()
      .default("pending"),
    switchedAt: timestamp("switched_at", { withTimezone: true }),
    switchedByMemberId: uuid("switched_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    /** The integrations to repoint at Open Incident, ticked one by one. */
    checklist: jsonb("checklist")
      .$type<Array<{ key: string; label: string; done: boolean }>>()
      .notNull()
      .default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("migration_team_switch_team").on(t.runId, t.teamExternalId)],
);
