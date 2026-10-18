/**
 * Dependencies between services, as people settled them.
 *
 * The traces say what calls what; this table records what a person did with
 * that observation. A `declared` link is one somebody confirmed (or declared
 * outright, on an instance without traces); a `hidden` one is an observed call
 * somebody said not to show — a health checker, a shared proxy. Observed calls
 * nobody touched are not stored at all: they are read from the traces.
 */
import { index, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, members, services } from "./app";
import { tenants } from "./directory";

export type ServiceLinkState = "declared" | "hidden";

export const serviceLinks = app.table(
  "service_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The caller. */
    fromServiceId: uuid("from_service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    /** The one being called. */
    toServiceId: uuid("to_service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    state: text("state").$type<ServiceLinkState>().notNull().default("declared"),
    createdByMemberId: uuid("created_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("service_links_pair").on(t.tenantId, t.fromServiceId, t.toServiceId),
    index("service_links_to").on(t.tenantId, t.toServiceId),
  ],
);
