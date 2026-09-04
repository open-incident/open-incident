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
import { jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
