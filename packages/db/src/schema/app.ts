/**
 * `app` schema — the multi-tenant product core.
 *
 * Every table carries `tenant_id`, referencing `directory.tenants`; isolation is
 * enforced by the row-level security policies of sql/rls.sql, which only let a
 * row through inside `withTenant()` (client.ts). A table exists here because
 * code of the same milestone reads it — never ahead of its reader.
 */
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./directory";

export const app = pgSchema("app");

/* ---------- Enums ---------- */

export const memberRole = app.enum("member_role", ["owner", "admin", "responder", "viewer"]);
export const memberStatus = app.enum("member_status", ["active", "invited", "disabled"]);
export const incidentPhase = app.enum("incident_phase", [
  "triage",
  "active",
  "post_incident",
  "closed",
]);
export const incidentMode = app.enum("incident_mode", ["live", "retrospective", "test"]);
export const incidentVisibility = app.enum("incident_visibility", ["public", "private"]);
export const actorKind = app.enum("actor_kind", ["member", "system", "api", "ai"]);
export const participantKind = app.enum("participant_kind", ["participant", "observer"]);
export const followUpStatus = app.enum("follow_up_status", ["open", "done", "cancelled"]);
export const fieldType = app.enum("field_type", [
  "text",
  "long_text",
  "select",
  "multi_select",
  "number",
  "link",
  "catalog_entry",
]);
export const mailStatus = app.enum("mail_status", ["queued", "sent", "failed", "handled"]);
export const alertStatus = app.enum("alert_status", ["firing", "resolved"]);
export const alertUrgency = app.enum("alert_urgency", ["high", "low"]);
export const escalationStatus = app.enum("escalation_status", [
  "pending",
  "acked",
  "resolved",
  "exhausted",
  "cancelled",
]);
export const scheduleStatus = app.enum("schedule_status", ["draft", "published"]);
export const notificationMethodKind = app.enum("notification_method_kind", [
  "email",
  "sms",
  "voice",
  "webpush",
  "slack",
  "teams",
]);
export const notificationStatus = app.enum("notification_status", [
  "queued",
  "sent",
  "delivered",
  "failed",
  "handled",
]);

const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ---------- Workspace ---------- */

/**
 * What a workspace says about itself — one row per tenant. Split from
 * `directory.tenants` on purpose: the directory is read before any tenant
 * context exists and written by provisioning only; this row is edited from
 * Settings → General, under RLS like everything else.
 */
export const workspaces = app.table("workspaces", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Default language of the workspace; a member may override it (D6). */
  locale: text("locale").notNull().default("en"),
  timezone: text("timezone").notNull().default("Europe/Paris"),
  /** accentColor; logoUrl served by the product; logoKey/logoDarkKey name the objects in storage. */
  branding: jsonb("branding")
    .$type<{ accentColor?: string; logoUrl?: string; logoKey?: string; logoDarkKey?: string }>()
    .notNull()
    .default({}),
  /** What this workspace calls its post-mortem — "retrospective", "REX"… Null: the product's word. */
  postMortemTerm: text("post_mortem_term"),
  /** The sections a new post-mortem starts with; null: the product's six. */
  postMortemTemplate: jsonb("post_mortem_template").$type<PostMortemTemplateSection[] | null>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One section of the workspace's post-mortem template: what it is called, what it should hold. */
export type PostMortemTemplateSection = { key: string; title: string; hint: string };

/* ---------- People ---------- */

export const members = app.table(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: memberRole("role").notNull().default("responder"),
    status: memberStatus("status").notNull().default("invited"),
    /** Per-member language override; null follows the workspace (D6). */
    locale: text("locale"),
    /** Per-member timezone; null follows the workspace. On-call lives here. */
    timezone: text("timezone"),
    /** light | dark; null follows the device. Not decorative: the dark tokens are complete. */
    theme: text("theme").$type<"light" | "dark">(),
    avatarUrl: text("avatar_url"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    /** On-call shift reminders the member asked for (On-call → My notifications). */
    shiftReminders: jsonb("shift_reminders")
      .$type<{ beforeStart: boolean; atEnd: boolean }>()
      .notNull()
      .default({ beforeStart: true, atEnd: false }),
    /** The identity provider's id for this member (SCIM externalId). */
    externalId: text("external_id"),
    /** Where the row came from: an invitation, a first SSO sign-in, or SCIM. */
    source: text("source").$type<"ui" | "sso" | "scim">().notNull().default("ui"),
    /**
     * A custom role (enterprise edition) refining `role`, which stays the base
     * the role was built on — what the rest of the product falls back to.
     */
    customRoleId: uuid("custom_role_id").references((): AnyPgColumn => customRoles.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("members_tenant_email").on(t.tenantId, t.email),
    uniqueIndex("members_tenant_external").on(t.tenantId, t.externalId),
  ],
);

/**
 * Custom roles: a named permission set built on one of the built-in roles.
 * Enterprise edition — the screen lives in ee/, the table is core so that the
 * membership check reads it in one place.
 */
export const customRoles = app.table(
  "custom_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** The built-in role members of this role are shown as, and fall back to. */
    base: memberRole("base").notNull().default("responder"),
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("custom_roles_tenant_key").on(t.tenantId, t.key)],
);

/* ---------- Enterprise: single sign-on ---------- */

/**
 * A workspace's SSO connection — what the product knows about a provider the
 * Better Auth SSO plugin holds in auth.sso_provider (same `provider_id`).
 * Enterprise edition: the screens live in ee/, the table is core so that the
 * membership check and the sign-in page can read it.
 */
export const ssoConnections = app.table(
  "sso_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** The Better Auth provider id — unique across the instance. */
    providerId: text("provider_id").notNull(),
    kind: text("kind").$type<"oidc" | "saml">().notNull(),
    /** What the sign-in button says: "Okta", "Entra ID"… */
    label: text("label").notNull(),
    /** Role given to a member created on first SSO sign-in. */
    defaultRole: memberRole("default_role").notNull().default("responder"),
    /** Email domains allowed to sign in through this connection; empty: any. */
    allowedDomains: jsonb("allowed_domains").$type<string[]>().notNull().default([]),
    /** True: a password sign-in with an allowed domain is refused — SSO only. */
    enforce: boolean("enforce").notNull().default(false),
    /** Create the member on first sign-in; false: only existing members get in. */
    jitProvisioning: boolean("jit_provisioning").notNull().default(true),
    createdByMemberId: uuid("created_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("sso_connections_provider").on(t.providerId),
    index("sso_connections_tenant").on(t.tenantId),
  ],
);

/* ---------- Enterprise: SCIM provisioning ---------- */

/**
 * One SCIM 2.0 endpoint per workspace, at {origin}/scim/v2, opened by a bearer
 * token the identity provider holds. The token is stored as its SHA-256 and
 * shown once; rotating it writes a new hash. Enterprise edition.
 */
export const scimSettings = app.table(
  "scim_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    tokenHash: text("token_hash").notNull(),
    tokenHint: text("token_hint").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Role of a member the provider creates; the provider may override it with `roles`. */
    defaultRole: memberRole("default_role").notNull().default("responder"),
    /** Send the invitation email to a provisioned member (useful without SSO). */
    sendInvites: boolean("send_invites").notNull().default(true),
    createdByMemberId: uuid("created_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("scim_settings_tenant").on(t.tenantId)],
);

/* ---------- QA — test suites run from the admin ---------- */

export type QaSuite = "smoke" | "unit" | "typecheck" | "lint" | "format";
export type QaStatus = "queued" | "running" | "passed" | "failed" | "error" | "cancelled";
/** What a run boils down to once parsed: counts and the names of what failed. */
export type QaSummary = {
  total?: number;
  passed?: number;
  failed?: number;
  flaky?: number;
  skipped?: number;
  /** Failed tests or tasks, with a location and a short reason when known. */
  failures?: Array<{ title: string; location?: string; message?: string }>;
  /** Free-form lines worth showing (task summary, versions). */
  notes?: string[];
};

/**
 * A run of one test suite, launched from Settings → QA and executed by the
 * worker on the machine that has the repository. The log is the child
 * process's output, truncated when very long; the summary is what the parser
 * made of it. Owner-only on the screen; audited.
 */
export const qaRuns = app.table(
  "qa_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    suite: text("suite").$type<QaSuite>().notNull(),
    status: text("status").$type<QaStatus>().notNull().default("queued"),
    /** The command actually run, for the record. */
    command: text("command").notNull().default(""),
    exitCode: integer("exit_code"),
    summary: jsonb("summary").$type<QaSummary>().notNull().default({}),
    log: text("log").notNull().default(""),
    logTruncated: boolean("log_truncated").notNull().default(false),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    triggeredByMemberId: uuid("triggered_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    triggeredByName: text("triggered_by_name").notNull().default(""),
    queuedAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("qa_runs_tenant_queued").on(t.tenantId, t.queuedAt)],
);

/* ---------- Response — configuration ---------- */

export const severities = app.table(
  "severities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** SEV1, SEV2… — the short label, in mono on screen. */
    name: text("name").notNull(),
    description: text("description"),
    /** 0 = most severe. */
    rank: integer("rank").notNull(),
    /** always | yes | opt_in | never — does this level start the post-incident flow. */
    postIncident: text("post_incident")
      .$type<"always" | "yes" | "opt_in" | "never">()
      .notNull()
      .default("opt_in"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("severities_tenant_name").on(t.tenantId, t.name)],
);

export type DeclareFormField = {
  /** System fields: title | severity | service | summary; otherwise a custom field key. */
  key: string;
  required: boolean;
};

export const incidentTypes = app.table(
  "incident_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    description: text("description"),
    isDefault: boolean("is_default").notNull().default(false),
    /** Incidents of this type start private (security, HR). */
    privateByDefault: boolean("private_by_default").notNull().default(false),
    /** Ids of the `app.teams` rows allowed to declare; null = everyone. */
    restrictedToTeamIds: jsonb("restricted_to_team_ids").$type<string[] | null>(),
    /** Minimum severity rank that enters the post-incident flow automatically; null = never, -1 = always. */
    postIncidentFromRank: integer("post_incident_from_rank"),
    declareForm: jsonb("declare_form").$type<DeclareFormField[]>().notNull().default([]),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("incident_types_tenant_name").on(t.tenantId, t.name)],
);

/**
 * Statuses of the ACTIVE phase, per type. The other phases — triage,
 * post-incident, closed — are the product's own and need no row: an incident in
 * them carries its phase and no status.
 */
export const incidentStatuses = app.table(
  "incident_statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    typeId: uuid("type_id")
      .notNull()
      .references(() => incidentTypes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    rank: integer("rank").notNull(),
    /** Suggested "next update in" when an update is posted in this status. */
    updateReminderMinutes: integer("update_reminder_minutes"),
    countsInMttr: boolean("counts_in_mttr").notNull().default(true),
    /** investigating | identified | monitoring — the public status page vocabulary. */
    publicStatus: text("public_status"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("incident_statuses_type_name").on(t.typeId, t.name)],
);

export const incidentRoles = app.table(
  "incident_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    description: text("description"),
    /** Private instructions sent to whoever takes the role. */
    instructions: text("instructions"),
    runbookUrl: text("runbook_url"),
    /** The one seeded role the product reasons about (auto-assignment, "lead" column). */
    isLead: boolean("is_lead").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("incident_roles_tenant_name").on(t.tenantId, t.name)],
);

export const incidentFields = app.table(
  "incident_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** Machine key, mono on screen: region, customer_impact… */
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: fieldType("type").notNull(),
    description: text("description"),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    /** The type whose declare form carries this field; null = available to every type. */
    incidentTypeId: uuid("incident_type_id").references(() => incidentTypes.id, {
      onDelete: "cascade",
    }),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("incident_fields_tenant_key").on(t.tenantId, t.key)],
);

export const followUpPriorities = app.table(
  "follow_up_priorities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** P1, P2, P3. */
    name: text("name").notNull(),
    description: text("description"),
    rank: integer("rank").notNull(),
    /** Policy: a follow-up of this priority must be closed within N days; null = no deadline. */
    completeWithinDays: integer("complete_within_days"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("follow_up_priorities_tenant_name").on(t.tenantId, t.name)],
);

/* ---------- Response — incidents ---------- */

export const incidents = app.table(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** INC-{number}, sequential per workspace — see nextIncidentNumber(). */
    number: integer("number").notNull(),
    name: text("name").notNull(),
    summary: text("summary"),
    mode: incidentMode("mode").notNull().default("live"),
    visibility: incidentVisibility("visibility").notNull().default("public"),
    typeId: uuid("type_id")
      .notNull()
      .references(() => incidentTypes.id),
    severityId: uuid("severity_id").references(() => severities.id),
    phase: incidentPhase("phase").notNull().default("active"),
    /** Meaningful in the active phase only. */
    statusId: uuid("status_id").references(() => incidentStatuses.id, { onDelete: "set null" }),
    /** The service the incident is about — the one paging and reporting read. */
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    creatorMemberId: uuid("creator_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    /** alert | api | web | chat — where the declaration came from. */
    source: text("source").notNull().default("web"),
    /** The war room: a video-call link attached at declaration (Meet, Zoom…). */
    bridgeUrl: text("bridge_url"),
    /** The assistant's summary of the timeline — a draft, regenerable, never the human summary. */
    aiSummary: text("ai_summary"),
    aiSummaryAt: timestamp("ai_summary_at", { withTimezone: true }),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
    /* Key timestamps, denormalised for lists and metrics; the timeline holds the detail. */
    declaredAt: timestamp("declared_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** When the next status update is due — the reminder job reads it. */
    nextUpdateDueAt: timestamp("next_update_due_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    mergedIntoId: uuid("merged_into_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("incidents_tenant_number").on(t.tenantId, t.number),
    index("incidents_tenant_phase").on(t.tenantId, t.phase, t.lastActivityAt),
  ],
);

export type IncidentEventKind =
  | "declared"
  | "created_from_alert"
  | "accepted"
  | "declined"
  | "merged"
  | "status_changed"
  | "severity_changed"
  | "update_posted"
  | "role_assigned"
  | "role_unassigned"
  | "note"
  | "alert_attached"
  | "escalation_triggered"
  | "escalation_acknowledged"
  | "link_added"
  | "deployment"
  | "action_created"
  | "action_completed"
  | "follow_up_created"
  | "follow_up_completed"
  | "resolved"
  | "reopened"
  | "closed"
  | "post_incident_started"
  | "task_completed"
  | "task_skipped"
  | "post_mortem_published"
  | "custom_field_changed"
  | "visibility_changed"
  | "renamed"
  | "announcement_published"
  | "investigation";

/**
 * The timeline — append-only, and the ONE source of the live views (SSE reads
 * this table, nothing else). Every kind carries a small payload the screens
 * render through the dictionaries; the text is never stored pre-rendered.
 */
export const incidentEvents = app.table(
  "incident_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    kind: text("kind").$type<IncidentEventKind>().notNull(),
    actorKind: actorKind("actor_kind").notNull().default("member"),
    actorMemberId: uuid("actor_member_id").references(() => members.id, { onDelete: "set null" }),
    /** Snapshot of the actor's display name: the timeline outlives the account. */
    actorName: text("actor_name"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("incident_events_incident_time").on(t.incidentId, t.occurredAt)],
);

export const incidentUpdates = app.table(
  "incident_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    statusId: uuid("status_id").references(() => incidentStatuses.id, { onDelete: "set null" }),
    severityId: uuid("severity_id").references(() => severities.id, { onDelete: "set null" }),
    /** True when the update resolved the incident. */
    resolves: boolean("resolves").notNull().default(false),
    message: text("message").notNull(),
    nextUpdateDueAt: timestamp("next_update_due_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("incident_updates_incident").on(t.incidentId, t.createdAt)],
);

export const roleAssignments = app.table(
  "role_assignments",
  {
    tenantId: tenantId(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => incidentRoles.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.incidentId, t.roleId] })],
);

export const incidentParticipants = app.table(
  "incident_participants",
  {
    tenantId: tenantId(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    kind: participantKind("kind").notNull().default("observer"),
    firstActivityAt: timestamp("first_activity_at", { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.incidentId, t.memberId] })],
);

export const actions = app.table(
  "actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    assigneeMemberId: uuid("assignee_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    createdByMemberId: uuid("created_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("actions_incident").on(t.incidentId)],
);

export type FollowUpExternalRef = {
  tracker: "github" | "gitlab" | "jira" | "linear";
  key: string;
  url?: string;
  /** The tracker's own identifier when it differs from the key (GitHub number, Linear id). */
  id?: string;
};

export const followUps = app.table(
  "follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    priorityId: uuid("priority_id").references(() => followUpPriorities.id, {
      onDelete: "set null",
    }),
    assigneeMemberId: uuid("assignee_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    status: followUpStatus("status").notNull().default("open"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    externalRef: jsonb("external_ref").$type<FollowUpExternalRef | null>(),
    labels: text("labels").array().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("follow_ups_tenant_status").on(t.tenantId, t.status, t.dueAt)],
);

/* ---------- Post-incident ---------- */

/**
 * The flow's task definitions, per workspace: two seeded phases (documenting,
 * reviewing), each with its tasks. An incident entering the flow gets one
 * `post_incident_tasks` row per definition.
 */
export const postIncidentTaskDefs = app.table(
  "post_incident_task_defs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** documenting | reviewing */
    phase: text("phase").$type<"documenting" | "reviewing">().notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** lead | communication | creator — who gets the task by default. */
    defaultAssigneeRole: text("default_assignee_role"),
    dueAfterDays: integer("due_after_days"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("post_incident_task_defs_tenant").on(t.tenantId, t.phase, t.position)],
);

export const postIncidentTasks = app.table(
  "post_incident_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    defId: uuid("def_id").references(() => postIncidentTaskDefs.id, { onDelete: "set null" }),
    phase: text("phase").$type<"documenting" | "reviewing">().notNull(),
    title: text("title").notNull(),
    assigneeMemberId: uuid("assignee_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Skipping needs a reason — and is traced in the timeline. */
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    skipReason: text("skip_reason"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("post_incident_tasks_incident").on(t.incidentId, t.phase, t.position)],
);

export const postMortems = app.table("post_mortems", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  incidentId: uuid("incident_id")
    .notNull()
    .unique()
    .references(() => incidents.id, { onDelete: "cascade" }),
  /** in_progress | in_review | completed */
  status: text("status")
    .$type<"in_progress" | "in_review" | "completed">()
    .notNull()
    .default("in_progress"),
  /** Sections of the native document; the editor lands with the design. */
  sections: jsonb("sections")
    .$type<Array<{ key: string; title: string; body: string }>>()
    .notNull()
    .default([]),
  /** True when the first draft was produced by the assistant — shown as a banner. */
  aiDrafted: boolean("ai_drafted").notNull().default(false),
  /** The document's own title; null reads "INC-n — name". */
  title: text("title"),
  /** The assistant's check of each section against the incident's facts, and when it ran. */
  reviewNotes: jsonb("review_notes").$type<ReviewNote[] | null>(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  updatedByMemberId: uuid("updated_by_member_id").references(() => members.id, {
    onDelete: "set null",
  }),
  updatedByName: text("updated_by_name"),
  externalUrl: text("external_url"),
  ownerMemberId: uuid("owner_member_id").references(() => members.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One line of the assistant's review: does the section hold against the material? */
export type ReviewNote = {
  key: string;
  verdict: "supported" | "gap" | "contradiction";
  note: string;
};

export type PostMortemRevisionKind =
  "edit" | "ai_draft" | "ai_section" | "ai_refine" | "structure" | "restore" | "title";

/**
 * The document's history: one snapshot per change, who made it and how — a
 * person's edit, the assistant's draft, a section added or moved, a restore.
 */
export const postMortemRevisions = app.table(
  "post_mortem_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    postMortemId: uuid("post_mortem_id")
      .notNull()
      .references(() => postMortems.id, { onDelete: "cascade" }),
    kind: text("kind").$type<PostMortemRevisionKind>().notNull(),
    sectionKey: text("section_key"),
    title: text("title"),
    sections: jsonb("sections")
      .$type<Array<{ key: string; title: string; body: string }>>()
      .notNull()
      .default([]),
    actorMemberId: uuid("actor_member_id").references(() => members.id, { onDelete: "set null" }),
    actorName: text("actor_name"),
    createdAt: createdAt(),
  },
  (t) => [index("post_mortem_revisions_pm_created").on(t.postMortemId, t.createdAt)],
);

/** Comments on a section (or on the document when the section is null), resolvable. */
export const postMortemComments = app.table(
  "post_mortem_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    postMortemId: uuid("post_mortem_id")
      .notNull()
      .references(() => postMortems.id, { onDelete: "cascade" }),
    sectionKey: text("section_key"),
    body: text("body").notNull(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    memberName: text("member_name").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByName: text("resolved_by_name"),
    createdAt: createdAt(),
  },
  (t) => [index("post_mortem_comments_pm").on(t.postMortemId)],
);

export const debriefs = app.table("debriefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  incidentId: uuid("incident_id")
    .notNull()
    .unique()
    .references(() => incidents.id, { onDelete: "cascade" }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(45),
  attendeeMemberIds: jsonb("attendee_member_ids").$type<string[]>().notNull().default([]),
  invitationSentAt: timestamp("invitation_sent_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/* ---------- Audit ---------- */

/**
 * Who did what, when — readable by a human from day one. The actor is ALWAYS
 * named: a snapshot of the name, so the line survives the member.
 */
export const auditEvents = app.table(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    actorMemberId: uuid("actor_member_id").references(() => members.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    /** config | security | members | data */
    category: text("category").$type<"config" | "security" | "members" | "data">().notNull(),
    /** workspace.updated, member.invited, member.role_changed… */
    action: text("action").notNull(),
    target: jsonb("target").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_tenant_time").on(t.tenantId, t.createdAt)],
);

/* ---------- API keys & webhooks ---------- */

export type ApiScope = "read" | "write" | "incident:create";

/**
 * `oi_live_[a-f0-9]{32}`, stored as its SHA-256 only — shown once, at
 * creation. The key resolves its workspace through directory.api_key_lookup;
 * this row is what the workspace sees and revokes.
 */
export const apiKeys = app.table(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    /** "oi_live_a4f2" — the displayable head of the key. */
    prefix: text("prefix").notNull(),
    /** The four last characters, for "oi_live_a4f2…c91b". */
    lastFour: text("last_four").notNull(),
    scopes: text("scopes").array().$type<ApiScope[]>().notNull().default([]),
    createdByMemberId: uuid("created_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_keys_hash").on(t.keyHash)],
);

export const webhookEndpoints = app.table(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    url: text("url").notNull(),
    /** Signing secret, encrypted at rest (packages/crypto). */
    encryptedSecret: text("encrypted_secret").notNull(),
    events: text("events").array().notNull().default([]),
    active: boolean("active").notNull().default(true),
    /** First failure of the current streak; cleared by the next success. */
    failingSince: timestamp("failing_since", { withTimezone: true }),
    /** Switched off after seven days of failures — the log keeps the evidence. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdByMemberId: uuid("created_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_endpoints_tenant").on(t.tenantId)],
);

export const webhookDeliveries = app.table(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** Null: no response at all (network failure, timeout). */
    httpStatus: integer("http_status"),
    latencyMs: integer("latency_ms"),
    attempt: integer("attempt").notNull().default(1),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_deliveries_endpoint_time").on(t.endpointId, t.createdAt)],
);

/* ---------- Announcements ---------- */

/** Who a living post is for. `owner_team`: the team owning the incident's service. */
export type AnnouncementAudience = "workspace" | "owner_team" | "role_holders";

export const announcementTemplates = app.table(
  "announcement_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    audience: text("audience").$type<AnnouncementAudience>().notNull().default("workspace"),
    /** Variables in braces: {severity} {title} {status} {next_update} {number} {service}. */
    body: text("body").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("announcement_templates_tenant_name").on(t.tenantId, t.name)],
);

export const announcementRules = app.table(
  "announcement_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    /** Fires for severities of this rank or more severe (0 = SEV1). Null: any severity. */
    minSeverityRank: integer("min_severity_rank"),
    /** Fires for this type only. Null: any type. */
    typeId: uuid("type_id").references(() => incidentTypes.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => announcementTemplates.id, { onDelete: "cascade" }),
    audience: text("audience").$type<AnnouncementAudience>().notNull().default("workspace"),
    triggeredCount: integer("triggered_count").notNull().default(0),
    lastIncidentId: uuid("last_incident_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("announcement_rules_tenant").on(t.tenantId)],
);

/**
 * A living post: one per incident and rule, rewritten in place at every
 * change of the incident — never a new message per update.
 */
export const announcements = app.table(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id").references(() => announcementRules.id, { onDelete: "set null" }),
    templateId: uuid("template_id").references(() => announcementTemplates.id, {
      onDelete: "set null",
    }),
    audience: text("audience").$type<AnnouncementAudience>().notNull(),
    body: text("body").notNull(),
    /** live while the incident is open; closed once it is. */
    status: text("status").$type<"live" | "closed">().notNull().default("live"),
    /** Where the post lives in chat, so the same message is updated rather than reposted. */
    chatRef: jsonb("chat_ref").$type<{
      channelId?: string;
      ts?: string;
      teams?: { threadId: string; activityId: string };
    } | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("announcements_incident_rule").on(t.incidentId, t.ruleId),
    index("announcements_tenant_status").on(t.tenantId, t.status),
  ],
);

/* ---------- Mail outbox ---------- */

export const mailDeliveries = app.table(
  "mail_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    kind: text("kind").notNull().default("other"),
    provider: text("provider").notNull().default("console"),
    status: mailStatus("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    /** What the email is about — an incident, an escalation. Never the body. */
    ref: text("ref"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("mail_deliveries_tenant_time").on(t.tenantId, t.createdAt)],
);

/* ---------- On-call & alerting — configuration ---------- */

/** How a source's payload feeds an alert attribute: a JSON path into the raw payload. */
export type AttributeMapping = {
  attribute: string;
  /** Dot path into the raw payload, e.g. "labels.service" or "scope.service". */
  path: string;
  /** Static value when no path applies. */
  value?: string;
  /** A light reshaping of the extracted string — what a JavaScript one-liner would do. */
  transform?: MappingTransform;
  /** Keep the value only when it matches this regular expression; a capture group replaces it. */
  match?: string;
};

export type MappingTransform =
  "lower" | "upper" | "after_colon" | "before_colon" | "first_word" | "trim";

/* ---------- Alert attributes — the registry every source maps onto ---------- */

export type AlertAttributeType = "text" | "list" | "priority" | "service" | "team";
/** What happens to an attribute when the same alert fires again with a new value. */
export type MergeStrategy = "first" | "last" | "accumulate" | "max";

/**
 * The workspace's alert attributes: one consistent vocabulary every source maps
 * its payload onto, so routes never care where an alert came from. Two of the
 * types name a real row — `service` resolves against `app.services`, `team`
 * against `app.teams` — and that is what makes an attribute routable.
 */
export const alertAttributes = app.table(
  "alert_attributes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    type: text("type").$type<AlertAttributeType>().notNull().default("text"),
    /**
     * Dead column, read once. Rows written before `service` and `team` became
     * types hold the generic type and the name of what it pointed at here;
     * `alertAttributeTypeOf` reads them forward. Never written, dropped next.
     */
    catalogTypeKey: text("catalog_type_key"),
    /** Required: every alert should carry it; sources missing it are flagged, alerts without it counted. */
    required: boolean("required").notNull().default(false),
    mergeStrategy: text("merge_strategy").$type<MergeStrategy>().notNull().default("last"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("alert_attributes_tenant_key").on(t.tenantId, t.key)],
);

/**
 * The type of an attribute as the product understands it today.
 *
 * A row the workspace has not touched since the two concrete types existed
 * still says the generic word and names its target in the dead column; read
 * forward, `service` and `team` are the two that ever meant anything, and
 * anything else was a dimension the product no longer keeps.
 */
export function alertAttributeTypeOf(row: {
  type: string;
  catalogTypeKey?: string | null;
}): AlertAttributeType {
  if (
    row.type === "service" ||
    row.type === "team" ||
    row.type === "list" ||
    row.type === "priority"
  )
    return row.type;
  if (row.catalogTypeKey === "service" || row.catalogTypeKey === "team") return row.catalogTypeKey;
  return "text";
}

/** How a source sets the alert's priority: the same for every alert, or read from a payload field. */
export type PriorityRule =
  | { mode: "static"; priorityId: string }
  | {
      mode: "field";
      path: string;
      /** Lower-cased payload value → priority id. Priority aliases apply when a value is not listed. */
      map: Record<string, string>;
      fallbackPriorityId: string | null;
    };

/* ---------- Conditions — shared by source filters, routes and escalation rules ---------- */

export type ConditionOp =
  "eq" | "neq" | "in" | "not_in" | "contains" | "matches" | "exists" | "missing";
/** `attribute` names an alert attribute, or one of `source`, `source_name`, `priority`, `title`. */
export type Condition = { attribute: string; op: ConditionOp; value?: string };
/** Groups are ORed; the conditions inside a group are ANDed. An empty list matches everything. */
export type ConditionGroup = { all: Condition[] };

export type AlertSourceKind =
  "http" | "prometheus" | "grafana" | "datadog" | "sentry" | "cloudwatch" | "uptime_kuma" | "email";

/**
 * One source = one dedicated ingest endpoint and one secret, compared in
 * constant time. The payload is stored raw; the mappings parse it downstream.
 */
export const alertSources = app.table(
  "alert_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    kind: text("kind").$type<AlertSourceKind>().notNull(),
    name: text("name").notNull(),
    secretHash: text("secret_hash").notNull(),
    /** Managed sources (heartbeats): the product itself posts to them, so it keeps the secret. */
    encryptedSecret: text("encrypted_secret"),
    managed: boolean("managed").notNull().default(false),
    mappings: jsonb("mappings").$type<AttributeMapping[]>().notNull().default([]),
    description: text("description"),
    /** The alert's priority, decided at the source — static, or from a payload field. */
    priorityRule: jsonb("priority_rule").$type<PriorityRule | null>(),
    /** Only alerts matching these conditions are ingested; resolutions always pass. */
    filter: jsonb("filter").$type<ConditionGroup[]>().notNull().default([]),
    /*
     * The three choices a source carries — who to page, whether an incident
     * opens, whether a resolution closes the escalation.
     *
     * They used to live in a route scoped to the source alone, which put them
     * in the list of rules where nobody had written them, and made a rule
     * created afterwards lose to them. They are the source's own answer now,
     * and a rule is what it says it is: the exception.
     *
     * Null on all three means the source has never been touched and follows
     * the catch-all, which is not the same answer as "page nobody" (an empty
     * list) or "never open an incident".
     */
    escalations: jsonb("escalations").$type<EscalationRule[] | null>(),
    incidentOpens: text("incident_opens").$type<"never" | "always" | "conditional">(),
    autoResolve: boolean("auto_resolve"),
    active: boolean("active").notNull().default(true),
    lastAlertAt: timestamp("last_alert_at", { withTimezone: true }),
    createdByMemberId: uuid("created_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("alert_sources_tenant_name").on(t.tenantId, t.name)],
);

/** Priority qualifies the alert; urgency picks the notification channel; severity qualifies the incident. */
export const alertPriorities = app.table(
  "alert_priorities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    description: text("description"),
    urgency: alertUrgency("urgency").notNull().default("high"),
    color: text("color").notNull().default("var(--ink-3)"),
    /** 0 = most important. */
    rank: integer("rank").notNull(),
    position: integer("position").notNull().default(0),
    /** What the tools call it — "critical", "sev1", "high" — matched case-insensitively. */
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    /** The priority an alert gets when nothing names one. */
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [uniqueIndex("alert_priorities_tenant_name").on(t.tenantId, t.name)],
);

/** Named sets of working hours, consumed by the "working hours" condition of escalation paths. */
export const workingHoursSets = app.table(
  "working_hours_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    /** ISO weekdays, 1 = Monday … 7 = Sunday. */
    days: jsonb("days").$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
    startTime: text("start_time").notNull().default("09:00"),
    endTime: text("end_time").notNull().default("18:00"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("working_hours_sets_tenant_name").on(t.tenantId, t.name)],
);

/**
 * Who a level pages.
 *
 * A team is named by its row in `app.teams`, which is where the product keeps
 * teams and their members.
 */
export type EscalationTarget =
  | { kind: "member"; memberId: string }
  | { kind: "schedule"; scheduleId: string; mode: "current" | "next" | "everyone" }
  | { kind: "team"; teamId: string };

/**
 * The typed graph of an escalation path. Each node names the next one; a level
 * waits for an acknowledgement, a condition branches, a delay pauses, a retry
 * loops back, a reassign hands over to another path.
 */
export type EscalationNode =
  | {
      id: string;
      kind: "level";
      targets: EscalationTarget[];
      urgency: "high" | "low";
      ackTimeoutMinutes: number;
      retries: number;
      retryIntervalMinutes: number;
      everyoneMustAck?: boolean;
      roundRobin?: boolean;
      next: string | null;
    }
  | {
      id: string;
      kind: "condition";
      test:
        | { type: "working_hours"; setId: string }
        | { type: "priority"; maxRank: number }
        | { type: "urgency"; urgency: "high" | "low" };
      whenTrue: string | null;
      whenFalse: string | null;
    }
  | {
      id: string;
      kind: "delay";
      minutes?: number;
      untilWorkingHoursSetId?: string;
      next: string | null;
    }
  | {
      id: string;
      kind: "retry";
      toNodeId: string;
      maxLoops: number;
      intervalMinutes: number;
      next: string | null;
    }
  | { id: string; kind: "reassign"; pathId: string };

export type EscalationGraph = { start: string | null; nodes: EscalationNode[] };

/** An escalation path: the published version pages; the draft is what is being edited. */
export const escalationPaths = app.table(
  "escalation_paths",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    description: text("description"),
    /** The version escalations start on. Null until the first publication. */
    currentVersionId: uuid("current_version_id"),
    draftGraph: jsonb("draft_graph").$type<EscalationGraph | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("escalation_paths_tenant_name").on(t.tenantId, t.name)],
);

export const escalationPathVersions = app.table(
  "escalation_path_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    pathId: uuid("path_id")
      .notNull()
      .references(() => escalationPaths.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    graph: jsonb("graph").$type<EscalationGraph>().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    publishedByMemberId: uuid("published_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
  },
  (t) => [uniqueIndex("escalation_path_versions_path_version").on(t.pathId, t.version)],
);

/**
 * Alert routes: filters on attributes → a static path, a dynamic one (service →
 * owner team → the team's path) or none → an incident never / always /
 * conditionally (in triage). Test mode logs everything and pages nobody.
 */
export type RouteFilter = { attribute: string; op: "eq" | "neq" | "in" | "exists"; value?: string };

/**
 * Who a route pages. A path, chosen once; or a path found from an alert
 * attribute — a service's owner team's path, or a team's own — with a
 * fallback when the chain does not resolve. Rules stack; each may carry its
 * own conditions.
 */
export type EscalationRule = (
  | { kind: "path"; pathId: string }
  | { kind: "attribute"; attribute: string; fallbackPathId: string | null }
) & { when?: ConditionGroup[] };

/** How an alert becomes an incident, when the route says so. */
export type IncidentTemplate = {
  /** never · always · conditional (only when the urgency is high). */
  mode: "never" | "always" | "conditional";
  typeId: string | null;
  startPhase: "triage" | "active";
  severity: { mode: "priority" } | { mode: "static"; severityId: string | null } | { mode: "none" };
  visibility: "public" | "private";
  /** Incident custom field key → alert attribute key. */
  customFields: Record<string, string>;
  /** A triage incident is declined when the alert that opened it resolves. */
  declineOnResolve: boolean;
};

/** Related alerts handled as one: the same key within the window join the first. */
export type GroupingRule = {
  enabled: boolean;
  /** Attributes the key is built from; empty groups every alert of the route. */
  by: string[];
  windowMinutes: number;
  /** Extending: the window restarts at each alert that joins; otherwise it counts from the first. */
  extending: boolean;
  /** What a joining alert does to paging: nothing, page again, page when the priority rises. */
  escalate: "never" | "every" | "increase";
  /** Minutes to wait before the first page, giving the group time to form. */
  graceMinutes: number;
};

export type NotifyRule = { slackChannelId: string | null; slackChannelName: string | null };

export const alertRoutes = app.table(
  "alert_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    testMode: boolean("test_mode").notNull().default(false),
    /** Legacy filters (AND only); `conditions` replaces them and wins when set. */
    filters: jsonb("filters").$type<RouteFilter[]>().notNull().default([]),
    /** The sources this route reads; empty = every source. */
    sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
    conditions: jsonb("conditions").$type<ConditionGroup[]>().notNull().default([]),
    escalations: jsonb("escalations").$type<EscalationRule[]>().notNull().default([]),
    incident: jsonb("incident").$type<IncidentTemplate | null>(),
    grouping: jsonb("grouping").$type<GroupingRule | null>(),
    notify: jsonb("notify").$type<NotifyRule | null>(),
    escalationMode: text("escalation_mode")
      .$type<"static" | "dynamic" | "none">()
      .notNull()
      .default("dynamic"),
    escalationPathId: uuid("escalation_path_id").references(() => escalationPaths.id, {
      onDelete: "set null",
    }),
    urgencyOverride: alertUrgency("urgency_override"),
    /** Static priority when the payload names none. */
    priorityId: uuid("priority_id").references(() => alertPriorities.id, { onDelete: "set null" }),
    incidentMode: text("incident_mode")
      .$type<"never" | "always" | "conditional">()
      .notNull()
      .default("conditional"),
    incidentTypeId: uuid("incident_type_id").references(() => incidentTypes.id, {
      onDelete: "set null",
    }),
    deferMinutes: integer("defer_minutes").notNull().default(0),
    resolveClosesEscalation: boolean("resolve_closes_escalation").notNull().default(true),
    position: integer("position").notNull().default(0),
    alertCount: integer("alert_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("alert_routes_tenant_name").on(t.tenantId, t.name)],
);

/* ---------- On-call — schedules ---------- */

export const schedules = app.table(
  "schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    /** "HH:MM" in the schedule's timezone — when a shift changes hands. */
    handoverTime: text("handover_time").notNull().default("09:00"),
    /** When managers were last reminded of upcoming coverage gaps — one digest a day at most. */
    coverageRemindedAt: timestamp("coverage_reminded_at", { withTimezone: true }),
    status: scheduleStatus("status").notNull().default("draft"),
    /** Bearer for the iCal feed; rotating it invalidates every subscribed calendar. */
    icalToken: text("ical_token").notNull(),
    createdByMemberId: uuid("created_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("schedules_tenant_name").on(t.tenantId, t.name),
    uniqueIndex("schedules_ical_token").on(t.icalToken),
  ],
);

export type RotationInterval = "daily" | "weekly" | "monthly" | "weekend";

/**
 * A rotation (layer) of a schedule: ordered members taking turns at each
 * handover, within active hours (null = 24/7), from an effective date.
 */
export const rotations = app.table(
  "rotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    interval: text("interval").$type<RotationInterval>().notNull().default("weekly"),
    /** Weekly: ISO weekday of the handover (1 = Monday). */
    handoverDay: integer("handover_day").notNull().default(1),
    /** "HH:MM" — null on both = 24/7. */
    activeStart: text("active_start"),
    activeEnd: text("active_end"),
    memberIds: jsonb("member_ids").$type<string[]>().notNull().default([]),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("rotations_schedule").on(t.scheduleId)],
);

/** A one-off exception: someone else — or NOBODY (null member) — on a slot. */
export const scheduleOverrides = app.table(
  "schedule_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    rotationId: uuid("rotation_id").references(() => rotations.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    reason: text("reason").$type<"override" | "cover">().notNull().default("override"),
    createdByMemberId: uuid("created_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index("schedule_overrides_schedule").on(t.scheduleId, t.startAt)],
);

/** "Cover me": a member offers a slot; the first to accept gets an override. */
export const coverRequests = app.table(
  "cover_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    rotationId: uuid("rotation_id").references(() => rotations.id, { onDelete: "cascade" }),
    requesterMemberId: uuid("requester_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    status: text("status").$type<"open" | "accepted" | "cancelled">().notNull().default("open"),
    acceptedByMemberId: uuid("accepted_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("cover_requests_schedule").on(t.scheduleId, t.status)],
);

/* ---------- Alerts ---------- */

export const alerts = app.table(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => alertSources.id, { onDelete: "cascade" }),
    routeId: uuid("route_id").references(() => alertRoutes.id, { onDelete: "set null" }),
    dedupKey: text("dedup_key").notNull(),
    status: alertStatus("status").notNull().default("firing"),
    title: text("title").notNull(),
    description: text("description"),
    /** Stored as received; parsed downstream by the source's mappings. */
    payload: jsonb("payload").$type<unknown>().notNull(),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    priorityId: uuid("priority_id").references(() => alertPriorities.id, { onDelete: "set null" }),
    urgency: alertUrgency("urgency"),
    /** The alert this one was grouped under (the leader has null). */
    groupId: uuid("group_id"),
    /** The route's grouping key this alert carries — what a later alert must share to join. */
    groupKey: text("group_key"),
    groupCount: integer("group_count").notNull().default(1),
    incidentId: uuid("incident_id").references(() => incidents.id, { onDelete: "set null" }),
    escalationId: uuid("escalation_id"),
    externalUrl: text("external_url"),
    testMode: boolean("test_mode").notNull().default(false),
    firstAt: timestamp("first_at", { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
    ackedByMemberId: uuid("acked_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("alerts_tenant_status").on(t.tenantId, t.status, t.lastAt),
    index("alerts_source_dedup").on(t.sourceId, t.dedupKey),
    index("alerts_incident").on(t.incidentId),
  ],
);

export type AlertEventKind =
  | "triggered"
  | "grouped"
  | "routed"
  | "escalated"
  | "deferred"
  | "acknowledged"
  | "unacknowledged"
  | "snoozed"
  | "resolved"
  | "reopened"
  | "incident_created"
  | "incident_linked"
  | "test_mode";

export const alertEvents = app.table(
  "alert_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    kind: text("kind").$type<AlertEventKind>().notNull(),
    actorKind: actorKind("actor_kind").notNull().default("system"),
    actorMemberId: uuid("actor_member_id").references(() => members.id, { onDelete: "set null" }),
    actorName: text("actor_name"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("alert_events_alert").on(t.alertId, t.occurredAt)],
);

/* ---------- Escalations — the persisted state machine ---------- */

/**
 * A living escalation: which version of which path, where it stands (node,
 * attempt, loops), when the next tick is due. Transitions go through one
 * writer, `advanceEscalation()`, guarded by `row_version`.
 */
export const escalations = app.table(
  "escalations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    pathId: uuid("path_id")
      .notNull()
      .references(() => escalationPaths.id, { onDelete: "cascade" }),
    pathVersionId: uuid("path_version_id")
      .notNull()
      .references(() => escalationPathVersions.id, { onDelete: "cascade" }),
    alertId: uuid("alert_id").references(() => alerts.id, { onDelete: "set null" }),
    incidentId: uuid("incident_id").references(() => incidents.id, { onDelete: "set null" }),
    status: escalationStatus("status").notNull().default("pending"),
    urgency: alertUrgency("urgency").notNull().default("high"),
    /** Rank of the alert's priority, for the priority condition; null = unknown. */
    priorityRank: integer("priority_rank"),
    currentNodeId: text("current_node_id"),
    nodeEnteredAt: timestamp("node_entered_at", { withTimezone: true }),
    /** Notification attempt within the current level (1 = first page). */
    attempt: integer("attempt").notNull().default(1),
    /** Loops taken through retry nodes, keyed by node id. */
    retryLoops: jsonb("retry_loops").$type<Record<string, number>>().notNull().default({}),
    /** Members who acknowledged so far — a level may require everyone. */
    ackedMemberIds: jsonb("acked_member_ids").$type<string[]>().notNull().default([]),
    nextTickAt: timestamp("next_tick_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    ackedByMemberId: uuid("acked_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
    ackedChannel: text("acked_channel"),
    triggeredByKind: actorKind("triggered_by_kind").notNull().default("system"),
    triggeredByMemberId: uuid("triggered_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    triggeredByName: text("triggered_by_name"),
    isTest: boolean("is_test").notNull().default(false),
    rowVersion: integer("row_version").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("escalations_tenant_status_tick").on(t.tenantId, t.status, t.nextTickAt),
    index("escalations_alert").on(t.alertId),
    index("escalations_incident").on(t.incidentId),
  ],
);

export type EscalationEventKind =
  | "started"
  | "notified"
  | "retried"
  | "timeout"
  | "condition"
  | "delayed"
  | "acknowledged"
  | "unacknowledged"
  | "reassigned"
  | "exhausted"
  | "resolved"
  | "cancelled";

export const escalationEvents = app.table(
  "escalation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    escalationId: uuid("escalation_id")
      .notNull()
      .references(() => escalations.id, { onDelete: "cascade" }),
    kind: text("kind").$type<EscalationEventKind>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("escalation_events_escalation").on(t.escalationId, t.occurredAt)],
);

/* ---------- Notifications ---------- */

/** A verified way to reach a member: an email, a phone (SMS, voice), a browser (web push). */
export const notificationMethods = app.table(
  "notification_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    kind: notificationMethodKind("kind").notNull(),
    /** The address: email, E.164 phone, or the push subscription as JSON. */
    value: text("value").notNull(),
    label: text("label"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifyCodeHash: text("verify_code_hash"),
    verifyExpiresAt: timestamp("verify_expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notification_methods_member").on(t.memberId)],
);

export type NotificationStep = {
  kind: "email" | "sms" | "voice" | "webpush" | "slack" | "teams";
  delayMinutes: number;
};

/** Personal rule: the ordered steps for one urgency. */
export const notificationRules = app.table(
  "notification_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    urgency: alertUrgency("urgency").notNull(),
    steps: jsonb("steps").$type<NotificationStep[]>().notNull().default([]),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("notification_rules_member_urgency").on(t.memberId, t.urgency)],
);

/**
 * The outbox: written BEFORE the attempt, with honest statuses. The body
 * travels in the job; the row keeps what the settings screen needs to show.
 */
export const notificationDeliveries = app.table(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    methodKind: notificationMethodKind("method_kind").notNull(),
    /** Masked address, for the log — never the push subscription. */
    target: text("target").notNull(),
    kind: text("kind")
      .$type<"escalation" | "test" | "shift_reminder" | "cover_request" | "verification">()
      .notNull(),
    urgency: alertUrgency("urgency"),
    escalationId: uuid("escalation_id").references(() => escalations.id, { onDelete: "set null" }),
    alertId: uuid("alert_id").references(() => alerts.id, { onDelete: "set null" }),
    status: notificationStatus("status").notNull().default("queued"),
    providerRef: text("provider_ref"),
    error: text("error"),
    /** Random token of the one-tap acknowledgement link carried by this message. */
    ackToken: text("ack_token"),
    /** What is said — the alert's own words, kept so a lost job can be replayed. */
    message: jsonb("message")
      .$type<{ subject: string; text: string; url?: string }>()
      .notNull()
      .default({ subject: "", text: "" }),
    /** Not before — personal rules stagger the channels. */
    sendAfter: timestamp("send_after", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
  },
  (t) => [
    index("notification_deliveries_member").on(t.memberId, t.createdAt),
    index("notification_deliveries_escalation").on(t.escalationId),
    uniqueIndex("notification_deliveries_ack_token").on(t.ackToken),
  ],
);

/* ---------- Chat & integrations ---------- */

export type IntegrationKind =
  | "slack"
  | "teams"
  | "meet"
  | "zoom"
  | "github"
  | "gitlab"
  | "jira"
  | "linear"
  | "confluence"
  | "notion";

/** What a Microsoft Teams pairing is configured to do. */
export type TeamsConfig = {
  /** The customer's Azure AD tenant — Graph calls and personal chats need it. */
  aadTenantId: string;
  /** Bot Framework service URL for this team's region. */
  serviceUrl: string;
  /** The General channel the bot was paired from — the fallback for tests and announcements. */
  generalChannelId: string;
  channelMode: "auto" | "none";
  channelPrefix: string;
  announceChannelId: string | null;
  announceChannelName: string | null;
  /** Pairing in progress: the code the admin types in Teams, and its deadline. */
  pairingCode?: string;
  pairingExpiresAt?: string;
};

/** What a Slack install is configured to do. */
export type SlackConfig = {
  channelMode: "auto" | "none";
  channelPrefix: string;
  announceChannelId: string | null;
  announceChannelName: string | null;
  autoInvite: boolean;
};

/** A video-call integration is just a link template: {number} is the incident number. */
export type BridgeConfig = { template: string };

/**
 * One row per connected integration — the Slack app, a video-call link
 * template. Tokens are encrypted at rest; `external_id` is the Slack team id,
 * registered in directory.api_key_lookup so a callback can find its workspace.
 */
export const integrationInstalls = app.table(
  "integration_installs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    kind: text("kind").$type<IntegrationKind>().notNull(),
    externalId: text("external_id"),
    externalName: text("external_name"),
    encryptedSecrets: text("encrypted_secrets"),
    botUserId: text("bot_user_id"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    /** pending: a Teams pairing waiting for its code to be typed in Teams. */
    status: text("status").$type<"active" | "revoked" | "pending">().notNull().default("active"),
    installedByMemberId: uuid("installed_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("integration_installs_tenant_kind").on(t.tenantId, t.kind)],
);

/** The chat channel of an incident (#inc-217), with the header message we keep updating. */
export const incidentChannels = app.table(
  "incident_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"slack" | "teams">().notNull().default("slack"),
    channelId: text("channel_id").notNull(),
    channelName: text("channel_name").notNull(),
    headerTs: text("header_ts"),
    /** Provider details beyond the id — Teams: the header thread, its activity, the web link. */
    meta: jsonb("meta")
      .$type<{ threadId?: string; activityId?: string; webUrl?: string }>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("incident_channels_incident_kind").on(t.incidentId, t.kind),
    index("incident_channels_channel").on(t.channelId),
  ],
);

/** A member's identity in a chat tool, matched by email once and remembered. */
export const chatIdentities = app.table(
  "chat_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"slack" | "teams">().notNull().default("slack"),
    externalUserId: text("external_user_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("chat_identities_kind_user").on(t.tenantId, t.kind, t.externalUserId),
    uniqueIndex("chat_identities_member_kind").on(t.memberId, t.kind),
  ],
);

/* ---------- Status pages ---------- */

export type PublicStatus = "investigating" | "identified" | "monitoring" | "resolved";
export type PublicImpact = "none" | "degraded" | "partial_outage" | "major_outage";
export type ComponentState =
  "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance";
export type MaintenanceStatus = "scheduled" | "in_progress" | "completed" | "cancelled";

/** A public status page: its own address, branding and language, independent of the workspace. */
export const statusPages = app.table(
  "status_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    /** Global: `{slug}.{STATUS_BASE_DOMAIN}` must name one page across the instance. */
    slug: text("slug").notNull(),
    customDomain: text("custom_domain"),
    customDomainVerifiedAt: timestamp("custom_domain_verified_at", { withTimezone: true }),
    locale: text("locale").notNull().default("en"),
    accentColor: text("accent_color").notNull().default("#0B4A6F"),
    noindex: boolean("noindex").notNull().default(true),
    /** internal: only signed-in members of the workspace can open it. */
    visibility: text("visibility").$type<"public" | "internal">().notNull().default("public"),
    privacyUrl: text("privacy_url"),
    legalUrl: text("legal_url"),
    replyTo: text("reply_to"),
    /** Publication is suggested from an incident at or above this severity rank (0 = SEV1). */
    minSeverityRank: integer("min_severity_rank").notNull().default(1),
    feedHits: integer("feed_hits").notNull().default(0),
    createdByMemberId: uuid("created_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("status_pages_slug").on(t.slug),
    uniqueIndex("status_pages_custom_domain").on(t.customDomain),
  ],
);

export const statusPageComponents = app.table(
  "status_page_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => statusPages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    groupName: text("group_name"),
    /** One line under the name: what a visitor needs to recognise the thing. */
    description: text("description"),
    position: integer("position").notNull().default(0),
    /** The service behind it — how an incident finds its components. */
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    /**
     * The monitor this component tracks. Set, the component stops being told
     * what to say: its state, its uptime and its bars are read off the
     * monitor's own day rollup, and no human — nor a published incident — can
     * overwrite them. Null, the component is manual, as it always was.
     */
    monitorId: uuid("monitor_id").references(() => monitors.id, { onDelete: "set null" }),
    state: text("state").$type<ComponentState>().notNull().default("operational"),
    createdAt: createdAt(),
  },
  (t) => [
    index("status_page_components_page").on(t.pageId, t.position),
    index("status_page_components_monitor").on(t.monitorId),
  ],
);

/** Every non-operational stretch of a component — the base of uptime and of the 30-day bars. */
export const componentImpactHistory = app.table(
  "component_impact_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    componentId: uuid("component_id")
      .notNull()
      .references(() => statusPageComponents.id, { onDelete: "cascade" }),
    state: text("state").$type<ComponentState>().notNull(),
    fromAt: timestamp("from_at", { withTimezone: true }).notNull(),
    toAt: timestamp("to_at", { withTimezone: true }),
    statusPageIncidentId: uuid("status_page_incident_id"),
    maintenanceId: uuid("maintenance_id"),
  },
  (t) => [index("component_impact_history_component").on(t.componentId, t.fromAt)],
);

/** The public object — never the internal incident, which it may point to. */
export const statusPageIncidents = app.table(
  "status_page_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => statusPages.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").references(() => incidents.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    status: text("status").$type<PublicStatus>().notNull().default("investigating"),
    impact: text("impact").$type<PublicImpact>().notNull().default("degraded"),
    componentIds: jsonb("component_ids").$type<string[]>().notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("status_page_incidents_page").on(t.pageId, t.startedAt),
    index("status_page_incidents_incident").on(t.incidentId),
  ],
);

export const statusPageIncidentUpdates = app.table(
  "status_page_incident_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    statusPageIncidentId: uuid("status_page_incident_id")
      .notNull()
      .references(() => statusPageIncidents.id, { onDelete: "cascade" }),
    status: text("status").$type<PublicStatus>().notNull(),
    body: text("body").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    createdByMemberId: uuid("created_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    notifiedCount: integer("notified_count").notNull().default(0),
  },
  (t) => [index("status_page_incident_updates_incident").on(t.statusPageIncidentId, t.publishedAt)],
);

export const statusPageMaintenances = app.table(
  "status_page_maintenances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => statusPages.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    componentIds: jsonb("component_ids").$type<string[]>().notNull().default([]),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    status: text("status").$type<MaintenanceStatus>().notNull().default("scheduled"),
    /** scheduled → in progress → completed on the clock; off = by hand only. */
    autoTransitions: boolean("auto_transitions").notNull().default(true),
    createdByMemberId: uuid("created_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("status_page_maintenances_page").on(t.pageId, t.startAt)],
);

export const statusPageMaintenanceUpdates = app.table(
  "status_page_maintenance_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    maintenanceId: uuid("maintenance_id")
      .notNull()
      .references(() => statusPageMaintenances.id, { onDelete: "cascade" }),
    status: text("status").$type<MaintenanceStatus>().notNull(),
    body: text("body").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("status_page_maintenance_updates_m").on(t.maintenanceId, t.publishedAt)],
);

/** Email subscribers — double opt-in, one-click unsubscribe, unlimited. */
export const statusPageSubscribers = app.table(
  "status_page_subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => statusPages.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmToken: text("confirm_token").notNull(),
    unsubscribeToken: text("unsubscribe_token").notNull(),
    source: text("source").$type<"form" | "import">().notNull().default("form"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("status_page_subscribers_page_email").on(t.pageId, t.email),
    uniqueIndex("status_page_subscribers_confirm").on(t.confirmToken),
    uniqueIndex("status_page_subscribers_unsub").on(t.unsubscribeToken),
  ],
);

/** Pre-approved public wording, per public status. */
export const statusPageTemplates = app.table(
  "status_page_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => statusPages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").$type<PublicStatus>().notNull(),
    body: text("body").notNull(),
    approved: boolean("approved").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("status_page_templates_page").on(t.pageId, t.position)],
);

/* ---------- AI — governance, log, knowledge ---------- */

export type AiCapability =
  | "declare_suggest"
  | "summary"
  | "related"
  | "update_draft"
  | "follow_ups"
  | "post_mortem"
  | "investigate";

/** What the workspace lets the assistant do, and read. One row per tenant. */
export const aiSettings = app.table(
  "ai_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    enabled: boolean("enabled").notNull().default(true),
    /** Per capability; absent = on. */
    capabilities: jsonb("capabilities")
      .$type<Partial<Record<AiCapability, boolean>>>()
      .notNull()
      .default({}),
    sources: jsonb("sources")
      .$type<{ services: boolean; incidents: boolean; changeEvents: boolean; docs: boolean }>()
      .notNull()
      .default({ services: true, incidents: true, changeEvents: true, docs: false }),
    /** Private incidents feed the knowledge layer only with this explicit opt-in. */
    privateOptIn: boolean("private_opt_in").notNull().default(false),
    provider: text("provider"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("ai_settings_tenant").on(t.tenantId)],
);

/** Every call to a model — who, what, which model, when, how much — readable, not write-only. */
export const aiCalls = app.table(
  "ai_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    capability: text("capability").$type<AiCapability | "embed">().notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    actorKind: actorKind("actor_kind").notNull().default("member"),
    actorMemberId: uuid("actor_member_id").references(() => members.id, { onDelete: "set null" }),
    actorName: text("actor_name"),
    incidentId: uuid("incident_id").references(() => incidents.id, { onDelete: "set null" }),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    status: text("status").$type<"ok" | "failed">().notNull().default("ok"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_calls_tenant_created").on(t.tenantId, t.createdAt)],
);

/** The knowledge layer: one summarised, embedded document per object the assistant may read. */
export const atlasDocuments = app.table(
  "atlas_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    source: text("source")
      .$type<"incident" | "post_mortem" | "change_event" | "runbook">()
      .notNull(),
    refId: text("ref_id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    /** The embedding, as numbers — compared in the application; no extension required. */
    embedding: jsonb("embedding").$type<number[] | null>(),
    model: text("model"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("atlas_documents_source_ref").on(t.tenantId, t.source, t.refId)],
);

/** Deploys, flags, config changes — what changed before the incident. API and integrations feed it. */
export const changeEvents = app.table(
  "change_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    kind: text("kind").$type<"deploy" | "flag" | "config" | "other">().notNull().default("deploy"),
    title: text("title").notNull(),
    description: text("description"),
    /** The service this belongs to. */
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    environment: text("environment"),
    actorName: text("actor_name"),
    externalRef: text("external_ref"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("change_events_tenant_occurred").on(t.tenantId, t.occurredAt)],
);

/* ---------- Investigations — root cause analysis (RCA) ---------- */

export type InvestigationStatus = "queued" | "running" | "completed" | "failed";
export type InvestigationTrigger = "declaration" | "manual" | "signal" | "note" | "api";
/** Five levels, from a guess to a cause the material itself confirms. */
export type Confidence = "speculation" | "plausible" | "likely" | "strong" | "validated";
export type InvestigationCheckKind =
  "timeline" | "alerts" | "changes" | "similar_incidents" | "runbooks" | "ownership" | "notes";
/** One piece of evidence the analysis may cite — `E3`, `A1`, `C2`… — with where it leads. */
export type Citation = {
  id: string;
  kind: "event" | "alert" | "change" | "incident" | "runbook" | "owner" | "note";
  label: string;
  url: string | null;
};
/** One fact, established from cited evidence. */
export type Finding = {
  id: string;
  check: InvestigationCheckKind;
  statement: string;
  citations: string[];
};
/** What broke and why, with the confidence the evidence allows; contradicted ones stay visible. */
export type Hypothesis = {
  id: string;
  whatBroke: string;
  why: string;
  confidence: Confidence;
  state: "open" | "flagged" | "contradicted";
  findings: string[];
  nextSteps: string[];
  /** The adversarial reviewer's note, when it had one. */
  challenge: string | null;
  challengeCitations: string[];
};
export type InvestigationCheck = {
  kind: InvestigationCheckKind;
  status: "done" | "skipped" | "failed";
  count: number;
  ms: number;
  note: string | null;
};
export type InvestigationTriage = {
  severityHint: string | null;
  scope: string;
  escalate: boolean;
  rationale: string;
};
/** The single synthesis a responder reads first: what is going on, what caused it, what to do. */
export type InvestigationSummary = {
  whatsGoingOn: string;
  whatCaused: string | null;
  topHypothesisId: string | null;
  nextSteps: string[];
};
export type InvestigationNote = {
  id: string;
  memberId: string | null;
  memberName: string;
  body: string;
  at: string;
};
/** How close the analysis came to the cause the post-mortem documented — graded by a person. */
export type InvestigationGrade = "bullseye" | "on_target" | "miss" | "nowhere_near";

/**
 * The root cause analysis of one incident: re-assessed as signals land, one
 * row per incident, every assessment overwriting the last. Findings cite the
 * evidence index; hypotheses rest on findings; a person grades the result.
 */
export const investigations = app.table(
  "investigations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    incidentId: uuid("incident_id")
      .notNull()
      .unique()
      .references(() => incidents.id, { onDelete: "cascade" }),
    status: text("status").$type<InvestigationStatus>().notNull().default("queued"),
    trigger: text("trigger").$type<InvestigationTrigger>().notNull().default("declaration"),
    /** Paused: signals no longer re-assess; a person can still ask for one. */
    paused: boolean("paused").notNull().default(false),
    /** A trigger that arrived while an assessment was running — served right after it. */
    pendingTrigger: text("pending_trigger").$type<InvestigationTrigger | null>(),
    runs: integer("runs").notNull().default(0),
    triage: jsonb("triage").$type<InvestigationTriage | null>(),
    summary: jsonb("summary").$type<InvestigationSummary | null>(),
    hypotheses: jsonb("hypotheses").$type<Hypothesis[]>().notNull().default([]),
    findings: jsonb("findings").$type<Finding[]>().notNull().default([]),
    /** The evidence index the findings point to, as it was when assessed. */
    citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
    checks: jsonb("checks").$type<InvestigationCheck[]>().notNull().default([]),
    blastRadius: text("blast_radius"),
    /** What responders told the analysis — attributed, and cited like any evidence. */
    notes: jsonb("notes").$type<InvestigationNote[]>().notNull().default([]),
    model: text("model"),
    provider: text("provider"),
    /** The synthesis message in the incident channel, updated in place. */
    chatRef: jsonb("chat_ref").$type<{
      channelId?: string;
      ts?: string;
      teamsPosted?: boolean;
    } | null>(),
    grade: text("grade").$type<InvestigationGrade | null>(),
    gradeNote: text("grade_note"),
    gradedByMemberId: uuid("graded_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
    /** The last assessment's error, if it failed; earlier results stay. */
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("investigations_tenant_status").on(t.tenantId, t.status)],
);

/** Written context on an alert — what was checked, why it was resolved, a hand-over — without an incident. */
export const alertNotes = app.table(
  "alert_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    memberName: text("member_name").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("alert_notes_alert").on(t.alertId)],
);

/* ---------- Heartbeats — a cron that stops pinging is an alert ---------- */

/**
 * A dead-man's switch: something pings the URL on a cadence; silence beyond the
 * interval plus grace raises an alert through the workspace's own managed
 * source, and the next ping resolves it. Nothing is alerted before the first ping.
 */
export const heartbeats = app.table(
  "heartbeats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    description: text("description"),
    /** The service this belongs to. */
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    intervalSeconds: integer("interval_seconds").notNull().default(3600),
    graceSeconds: integer("grace_seconds").notNull().default(300),
    /** The token in the ping URL — shown to managers, so kept encrypted rather than hashed. */
    encryptedToken: text("encrypted_token").notNull(),
    status: text("status").$type<"waiting" | "up" | "down">().notNull().default("waiting"),
    lastPingAt: timestamp("last_ping_at", { withTimezone: true }),
    lastMissedAt: timestamp("last_missed_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("heartbeats_tenant_active").on(t.tenantId, t.active)],
);

/* ---------- On-call pay — rules and monthly reports ---------- */

/** Hourly rates in cents by category; the night window; the workspace's public holidays. One row per workspace. */
export const payRules = app.table(
  "pay_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    currency: text("currency").notNull().default("EUR"),
    standbyCents: integer("standby_cents").notNull().default(0),
    nightCents: integer("night_cents").notNull().default(0),
    weekendCents: integer("weekend_cents").notNull().default(0),
    holidayCents: integer("holiday_cents").notNull().default(0),
    nightStart: text("night_start").notNull().default("22:00"),
    nightEnd: text("night_end").notNull().default("07:00"),
    /** ISO dates (YYYY-MM-DD) counted as public holidays. */
    holidays: jsonb("holidays").$type<string[]>().notNull().default([]),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("pay_rules_tenant").on(t.tenantId)],
);

export type PayReportRow = {
  memberId: string;
  memberName: string;
  scheduleId: string;
  scheduleName: string;
  minutes: { standby: number; night: number; weekend: number; holiday: number };
  amountCents: number;
};

/** A month of on-call pay: a draft recomputed at will, then published and frozen. */
export const payReports = app.table(
  "pay_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** First day of the month, YYYY-MM-DD. */
    period: text("period").notNull(),
    status: text("status").$type<"draft" | "published">().notNull().default("draft"),
    currency: text("currency").notNull().default("EUR"),
    rows: jsonb("rows").$type<PayReportRow[]>().notNull().default([]),
    totalCents: integer("total_cents").notNull().default(0),
    /** The rules the amounts were computed with — frozen with the report. */
    rulesSnapshot: jsonb("rules_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedByMemberId: uuid("published_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pay_reports_tenant_period").on(t.tenantId, t.period)],
);

/* ---------- Runbooks — documentation the assistant may read ---------- */

/**
 * A runbook attached to a service (or to the workspace): pasted text, or a
 * file at a URL — GitHub and GitLab files through their APIs, anything else as
 * plain text — refreshed by the worker. Indexed in the knowledge layer only
 * when the workspace allows documentation as a source.
 */
export const runbooks = app.table(
  "runbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** The service this belongs to. */
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    sourceUrl: text("source_url"),
    content: text("content").notNull().default(""),
    contentHash: text("content_hash"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    fetchError: text("fetch_error"),
    createdByMemberId: uuid("created_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("runbooks_tenant_service").on(t.tenantId, t.serviceId)],
);

/* ---------- Monitors, probes, services ---------- */

/**
 * What a monitor watches. The ten the product checks itself; anything else
 * arrives as an alert from a tool that already watches it.
 *
 * `incoming` is the one that waits rather than calls: a webhook that must be
 * pinged, and whose silence past its window is the signal (a dead-man's switch).
 */
export type MonitorType =
  "http" | "api" | "ping" | "port" | "dns" | "ssl" | "domain" | "synthetic" | "incoming" | "manual";

/**
 * The state a monitor is in, as the reader sees it.
 *
 * `waiting` is its own state rather than a null status: a monitor created a
 * minute ago has not failed, it has not answered yet, and a screen that showed
 * it as offline would page for nothing.
 */
export type MonitorState = "online" | "degraded" | "offline" | "paused" | "waiting";

/** One rule of a monitor: what makes it online, degraded or offline. */
export type MonitorCriterion = {
  /** What is read on each check. */
  on:
    | "status_code"
    | "response_time_ms"
    | "body_contains"
    | "body_matches"
    | "header"
    | "reachable"
    | "days_to_expiry"
    | "record_value"
    | "ping_received_in";
  op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "contains" | "not_contains" | "matches";
  value: string;
  /** The header or record this reads, when `on` needs one. */
  field?: string;
  /** What holding this rule means. */
  then: MonitorState;
  /** Consecutive checks that must agree before the state changes. */
  forChecks?: number;
};

/**
 * The three choices a monitor carries, the same three an alert source carries:
 * who gets paged, whether an incident opens, and whether recovery closes it.
 *
 * `owner` resolves at paging time to the owner team's policy — which is why a
 * service with an owner needs no rule at all.
 */
export type SignalAction = {
  page:
    | { kind: "owner" }
    | { kind: "member"; memberId: string }
    | { kind: "team"; teamId: string }
    | { kind: "schedule"; scheduleId: string }
    | { kind: "policy"; pathId: string }
    | { kind: "nobody" };
  /**
   * When an incident opens: in triage whatever the alert, only when the alert
   * is urgent, or never.
   *
   * The per-priority spellings are what the first version stored and are kept
   * so old rows still read; the pipeline only knows the three above, and
   * offering a choice it cannot make is a promise the product would break.
   */
  incident: { from: "triage" | "urgent" | "never" | "p1" | "p2" | "p3" | "p4" };
  autoResolve: boolean;
};

export const monitorState = app.enum("monitor_state", [
  "online",
  "degraded",
  "offline",
  "paused",
  "waiting",
]);

/**
 * A probe: where a check is made from.
 *
 * Managed probes belong to the instance and are shared by every workspace;
 * a custom probe is a container the workspace runs itself, which is the only
 * way to watch something on a private network.
 */
export const probes = app.table(
  "probes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for the instance's own probes: they are not a workspace's property. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    region: text("region").notNull(),
    managed: boolean("managed").notNull().default(true),
    /** Compared in constant time when a custom probe reports; never shown again. */
    secretHash: text("secret_hash"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    version: text("version"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("probes_tenant").on(t.tenantId)],
);

/**
 * A service, as the product learns it exists.
 *
 * It is created the first time a signal names it — an alert label, a monitor,
 * later a trace — and not a moment earlier: nobody describes what they run
 * before their first page. `confirmed` marks the ones a human has adopted; the rest
 * are shown as "seen in traffic" and are one click from an owner.
 */
export const services = app.table(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** The name signals use: `checkout-api`. Unique per workspace, immutable. */
    key: text("key").notNull(),
    name: text("name"),
    /** The team paged when this service is named and no rule says otherwise. */
    ownerTeamId: uuid("owner_team_id"),
    labels: jsonb("labels").$type<Record<string, string>>().notNull().default({}),
    confirmed: boolean("confirmed").notNull().default(false),
    /** Where it was seen: source names, monitor ids — for "seen in 4 sources". */
    seenIn: jsonb("seen_in").$type<string[]>().notNull().default([]),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    /**
     * When telemetry first and last named this service. Separate from the two
     * columns above on purpose: a service can be known from an alert label for
     * months before a single span mentions it, and the onboarding screen needs
     * to say which of the two happened.
     */
    telemetryFirstSeenAt: timestamp("telemetry_first_seen_at", { withTimezone: true }),
    telemetryLastSeenAt: timestamp("telemetry_last_seen_at", { withTimezone: true }),
    /** Read from `telemetry.sdk.*`: "node", "go", "python"… Shown, never inferred further. */
    techStack: text("tech_stack"),
    /** Overrides the workspace retention for this service alone, in days. */
    retentionOverrideDays: integer("retention_override_days"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("services_tenant_key").on(t.tenantId, t.key),
    index("services_tenant_owner").on(t.tenantId, t.ownerTeamId),
  ],
);

/**
 * A team: people, and the policy that pages them.
 *
 * A table the routing can join against, because "page the owner" must resolve
 * in one hop rather than three.
 */
export const teams = app.table(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    /** The escalation path used when this team is paged. */
    policyPathId: uuid("policy_path_id").references(() => escalationPaths.id, {
      onDelete: "set null",
    }),
    chatChannel: text("chat_channel"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("teams_tenant_name").on(t.tenantId, t.name)],
);

export const teamMembers = app.table(
  "team_members",
  {
    tenantId: tenantId(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.memberId] }),
    index("team_members_tenant").on(t.tenantId),
  ],
);

/** A repeated check, its criteria, and the three choices it carries. */
export const monitors = app.table(
  "monitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    type: text("type").$type<MonitorType>().notNull(),
    /** URL, host, host:port, domain — what the type expects. */
    target: text("target").notNull().default(""),
    /** Per-type detail: method, headers, body, steps, record type, port. */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    intervalSeconds: integer("interval_seconds").notNull().default(60),
    /** Checks that must agree before a state change is published. */
    criteria: jsonb("criteria").$type<MonitorCriterion[]>().notNull().default([]),
    action: jsonb("action").$type<SignalAction>().notNull(),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    state: monitorState("state").notNull().default("waiting"),
    stateSince: timestamp("state_since", { withTimezone: true }),
    lastCheckAt: timestamp("last_check_at", { withTimezone: true }),
    lastLatencyMs: integer("last_latency_ms"),
    lastDetail: text("last_detail"),
    /** Incoming-request monitors: the path segment, and the silence that alerts. */
    incomingToken: text("incoming_token"),
    expectEverySeconds: integer("expect_every_seconds"),
    /** The alert this monitor has open, so recovery resolves that one. */
    openAlertId: uuid("open_alert_id"),
    paused: boolean("paused").notNull().default(false),
    createdByMemberId: uuid("created_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("monitors_tenant_state").on(t.tenantId, t.state),
    index("monitors_tenant_service").on(t.tenantId, t.serviceId),
    uniqueIndex("monitors_incoming_token").on(t.incomingToken),
  ],
);

/**
 * One result of one check, kept raw for the recent list and the latency chart.
 *
 * Old rows are rolled up into `monitor_days` and dropped: a minute-by-minute
 * history of a year is millions of rows nobody reads, while the day rollup is
 * what the 90-day bars and the uptime figure are made of.
 */
export const monitorChecks = app.table(
  "monitor_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    state: monitorState("state").notNull(),
    latencyMs: integer("latency_ms"),
    detail: text("detail"),
    /**
     * What the check produced beyond one number, when the type has more to
     * say. A synthetic run puts its per-step timings, the step that broke and
     * the key of its screenshot here; the other types leave it null. A column
     * rather than a second table: it is read with the check or not at all.
     */
    result: jsonb("result").$type<Record<string, unknown>>(),
    probeId: uuid("probe_id").references(() => probes.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("monitor_checks_monitor_at").on(t.monitorId, t.at)],
);

/**
 * The credentials a synthetic journey signs in with.
 *
 * Encrypted at rest with the same treatment as the chat tokens, written once
 * and never read back by a screen: the product returns the NAME so a journey
 * can say `{{secrets.PASSWORD}}`, and only the browser runner ever decrypts the
 * value. Deleting the monitor takes them with it.
 */
export const monitorSecrets = app.table(
  "monitor_secrets",
  {
    tenantId: tenantId(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    /** What `{{secrets.NAME}}` names. Letters, digits and underscores. */
    name: text("name").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.monitorId, t.name] }),
    index("monitor_secrets_tenant").on(t.tenantId),
  ],
);

/** A day of a monitor's life, in seconds — the bars, the uptime, the downtime. */
export const monitorDays = app.table(
  "monitor_days",
  {
    tenantId: tenantId(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    /** Calendar day in the workspace's timezone, as YYYY-MM-DD. */
    day: text("day").notNull(),
    onlineSeconds: integer("online_seconds").notNull().default(0),
    degradedSeconds: integer("degraded_seconds").notNull().default(0),
    offlineSeconds: integer("offline_seconds").notNull().default(0),
    checks: integer("checks").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.monitorId, t.day] }),
    index("monitor_days_tenant").on(t.tenantId, t.day),
  ],
);

/**
 * A rule: the exception to what a source or a monitor already decided.
 *
 * Ordered, and the first match wins — two rules never page twice for the same
 * alert. Without a rule nothing is lost: the signal's own three choices apply.
 */
export const alertRules = app.table(
  "alert_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    position: integer("position").notNull().default(0),
    /** Read back as a sentence, so it is stored as conditions rather than prose. */
    conditions: jsonb("conditions").$type<ConditionGroup[]>().notNull().default([]),
    actions: jsonb("actions")
      .$type<SignalAction & { labels?: Record<string, string>; mute?: boolean }>()
      .notNull(),
    active: boolean("active").notNull().default(true),
    /** Logs what it would have done and acts on nothing. */
    testMode: boolean("test_mode").notNull().default(false),
    matchedCount: integer("matched_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("alert_rules_tenant_position").on(t.tenantId, t.position)],
);

/* ---------- The bell ---------- */

export const memberNotificationKind = app.enum("member_notification_kind", [
  "paged",
  "incident",
  "follow_up",
  "mention",
]);

/**
 * What the product has to tell one member, inside the product.
 *
 * Paging wakes someone up; this does not. The bell is the story of what
 * happened to the things a member is on — they were paged, an incident they
 * lead moved, a follow-up landed on them, someone named them in a post-mortem.
 * It is neither a second alerting channel nor an audit log: the audit log
 * records who changed what, this records what one person should read.
 *
 * `groupKey` is what keeps a busy incident from flooding the panel. The same
 * key writes the same row again: the count grows, the wording is refreshed,
 * and the row comes back unread. Ten events on one incident are one line that
 * says ten, not ten lines.
 *
 * No partial index on the unread ones: a member's rows are bounded by the
 * grouping above and by the ninety-day purge, so the inbox index already
 * answers the badge in a handful of rows.
 */
export const memberNotifications = app.table(
  "member_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    kind: memberNotificationKind("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** Where the row leads — relative, so it survives a domain change. */
    url: text("url"),
    incidentId: uuid("incident_id").references(() => incidents.id, { onDelete: "cascade" }),
    alertId: uuid("alert_id").references(() => alerts.id, { onDelete: "cascade" }),
    groupKey: text("group_key").notNull(),
    count: integer("count").notNull().default(1),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("member_notifications_inbox").on(t.tenantId, t.memberId, t.createdAt),
    uniqueIndex("member_notifications_group").on(t.tenantId, t.memberId, t.groupKey),
  ],
);

/* ---------- Telemetry (spec 15) — configuration and state ----------
 *
 * The telemetry itself lives in ClickHouse; what a workspace decided about it
 * lives here, under the same row-level security as everything else. The split
 * is the rule of §15.2: PostgreSQL keeps configuration and state, ClickHouse
 * keeps the signal, never the other way round — which is also why the product
 * starts and pages people with no column store anywhere.
 */

/** One row per workspace, created on first use. Absent means "the defaults". */
export const telemetrySettings = app.table(
  "telemetry_settings",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Which signals this workspace accepts. A signal off is a 403, not a silent drop. */
    enabledSignals: jsonb("enabled_signals")
      .$type<string[]>()
      .notNull()
      .default(["logs", "traces", "metrics"]),
    retentionLogsDays: integer("retention_logs_days").notNull().default(15),
    retentionTracesDays: integer("retention_traces_days").notNull().default(15),
    /** Metrics are cheaper per row and more useful over time, hence the longer default. */
    retentionMetricsDays: integer("retention_metrics_days").notNull().default(30),
    /**
     * How many distinct series the workspace keeps. Past it, new series are
     * refused and counted while existing ones keep flowing — the order that
     * leaves working dashboards working while a mislabelled counter is found.
     * Null: the instance default.
     */
    cardinalityBudget: integer("cardinality_budget"),
    /**
     * Extra redaction, on top of the secret detectors that are never optional.
     * Each rule is a regular expression replaced by `[redacted]` at ingestion,
     * before anything is written — a scrub applied at read time would already
     * have stored the secret.
     */
    scrubRules: jsonb("scrub_rules").$type<string[]>().notNull().default([]),
    /** Cloud: past it, a notice and forced sampling — never a silent cut. */
    dailySoftCapGb: integer("daily_soft_cap_gb"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [],
);

/**
 * What a collector authenticates with.
 *
 * The key resolves its workspace BEFORE anything is decoded (§15.4): a payload
 * is never parsed on behalf of a tenant we have not identified. Shown once,
 * stored as a SHA-256 digest, compared in constant time.
 */
export const telemetryIngestionKeys = app.table(
  "telemetry_ingestion_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    keyHash: text("key_hash").notNull(),
    label: text("label").notNull(),
    signals: jsonb("signals").$type<string[]>().notNull().default(["logs", "traces", "metrics"]),
    /** Forces `service.name`, for a collector that cannot be trusted to set it. */
    pinnedServiceName: text("pinned_service_name"),
    rateLimitRpm: integer("rate_limit_rpm"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("telemetry_keys_hash").on(t.keyHash),
    index("telemetry_keys_tenant").on(t.tenantId),
  ],
);

/**
 * The last refusals, kept so onboarding can be honest.
 *
 * "Your collector is sending spans without service.name" is the sentence that
 * saves an afternoon; it only exists if the refusal was written down. A
 * hundred per workspace, oldest pruned by housekeeping.
 */
export const telemetryRejections = app.table(
  "telemetry_rejections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    keyId: uuid("key_id").references(() => telemetryIngestionKeys.id, { onDelete: "set null" }),
    signal: text("signal").notNull(),
    reason: text("reason").notNull(),
    /** Scrubbed before storage: a rejected payload is still a payload. */
    excerpt: text("excerpt").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("telemetry_rejections_tenant").on(t.tenantId, t.createdAt)],
);

/** What was ingested, per day and per signal — the number the screen shows and the cloud bills. */
export const telemetryUsage = app.table(
  "telemetry_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    day: text("day").notNull(),
    signal: text("signal").notNull(),
    rows: integer("rows").notNull().default(0),
    bytes: integer("bytes").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("telemetry_usage_day").on(t.tenantId, t.day, t.signal)],
);
