/**
 * `directory` schema — the ONE table readable before any tenant context exists.
 *
 * Resolving a request's host to a workspace has to happen before `withTenant()`
 * can be opened, so it cannot sit behind the row-level security of the `app`
 * schema. This table carries exactly what that resolution and the lifecycle
 * need — routing, status, entitlements — and nothing a workspace edits about
 * itself (name, language, branding live in `app.workspaces`). The application
 * role reads it and never writes it: provisioning does.
 */
import {
  boolean,
  doublePrecision,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const directory = pgSchema("directory");

export const tenants = directory.table("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  /** A domain the workspace answers on besides {slug}.BASE_DOMAIN. */
  customDomain: text("custom_domain").unique(),
  /** active | trial | suspended | deleting. */
  status: text("status").notNull().default("active"),
  /**
   * Why the workspace is suspended, as a stable code — not prose to display.
   * Read, never matched on loosely: the product maps known codes to its own
   * wording and falls back to a generic message for anything it does not know.
   * Null when active, and always null on a standalone instance.
   */
  suspendedReason: text("suspended_reason"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  /** Resolved capabilities written by a control plane — null: the core ones. */
  entitlements: jsonb("entitlements"),
  /** Label to display, written by the control plane — null: nothing to display. */
  planName: text("plan_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;

/**
 * API key → workspace, the ONE lookup that has to happen before a tenant
 * context exists: a key resolves its own workspace, whatever host the request
 * came in on. The row carries nothing but the hash and the tenant; the key's
 * name, scopes and usage live in `app.api_keys`, under RLS. The application
 * role may insert and delete here — the only write it has on this schema, and
 * the reason this table is separate from `tenants`.
 */
export const apiKeyLookup = directory.table("api_key_lookup", {
  keyHash: text("key_hash").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

/**
 * A shared dashboard's address, resolvable without a session.
 *
 * The third table of this shape, and by now clearly an idiom rather than a
 * workaround: anything reachable before a tenant context exists — an API key,
 * an ingestion key, a public dashboard link — needs one row outside the
 * policies that says whose it is. The dashboard itself stays in `app` under
 * row-level security, read normally once the workspace is known.
 */
export const dashboardShare = directory.table("dashboard_share", {
  token: text("token").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  dashboardId: uuid("dashboard_id").notNull(),
});

/**
 * The same trick for telemetry ingestion keys, and for the same reason.
 *
 * A collector authenticates before any tenant context exists, so the row it is
 * matched against cannot live under row-level security — the application role
 * would read nothing. The key's own record stays in `app` with the rest of the
 * workspace's configuration; this table holds only what the ingestion path
 * needs to answer "whose is this, and may it send that?" before it decodes a
 * single byte.
 */
export const telemetryKeyLookup = directory.table("telemetry_key_lookup", {
  keyHash: text("key_hash").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  keyId: uuid("key_id").notNull(),
  /** Duplicated from `app.telemetry_ingestion_keys` so one read answers everything. */
  signals: jsonb("signals").$type<string[]>().notNull().default(["logs", "traces", "metrics"]),
  pinnedServiceName: text("pinned_service_name"),
  revoked: boolean("revoked").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

/**
 * A real user monitoring application, resolvable before a workspace is known.
 *
 * The fourth thing to need this treatment, after API keys, telemetry keys and
 * shared dashboards, and for the same reason: `app.rum_applications` is under
 * row-level security, so reading it to find out whose workspace a browser
 * belongs to would return nothing — the very context we are trying to
 * establish.
 *
 * What is different here is that the identifier is **public on purpose**. A
 * browser cannot hold a secret; anything shipped in a page is readable by
 * anyone who loads it. So the app id is not a credential, and the thing that
 * stands in for one is the origin list: an event is accepted when it arrives
 * from a page the workspace said it would. That is weaker than a key and it is
 * the strongest thing available in a browser, which is worth saying plainly
 * rather than dressing an id up as a token.
 */
export const rumAppLookup = directory.table("rum_app_lookup", {
  appId: uuid("app_id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  /** Exact origins, `https://shop.example.com`. Empty accepts none. */
  allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull().default([]),
  /** 0 to 1. Applied in the browser, so a sampled-out session costs no request. */
  sampleRate: doublePrecision("sample_rate").notNull().default(1),
  /**
   * Replay, mirrored here because the browser asks for its configuration
   * before any tenant context exists — the application id is all it has.
   */
  replayEnabled: boolean("replay_enabled").notNull().default(false),
  replaySampleRate: doublePrecision("replay_sample_rate").notNull().default(0.1),
  replayUnmask: jsonb("replay_unmask").$type<string[]>().notNull().default([]),
  /** Whether a request with no `Origin` — an app, not a page — is accepted. */
  mobileEnabled: boolean("mobile_enabled").notNull().default(false),
  active: boolean("active").notNull().default(true),
});

/**
 * The public projection of a status page — what `apps/status` serves, and
 * all it reads. Written by the product on every change and by the worker's
 * tick; keyed by host so an unknown host is a 404, never a page.
 */
export const statusSnapshots = directory.table(
  "status_snapshots",
  {
    pageId: uuid("page_id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    customDomain: text("custom_domain"),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("status_snapshots_slug").on(t.slug),
    uniqueIndex("status_snapshots_custom_domain").on(t.customDomain),
  ],
);
