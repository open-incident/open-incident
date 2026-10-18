/**
 * The chat log — every message Open Incident sent to Slack or Teams, and
 * every gesture that came back from them, with the status it really had.
 *
 * Written by the chat adapter at the moment of the call (never guessed after
 * the fact) and read by Settings › Slack & Teams: the Health list, the "last
 * event" of a provider, the members a lookup could not find. Nothing decides
 * on it — it is the record, the way `notification_deliveries` is the record
 * of pages.
 */
import { index, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { app, incidents, members } from "./app";
import { tenants } from "./directory";

export type ChatProvider = "slack" | "teams";

export type ChatEventKind =
  /** An incident channel created. */
  | "channel"
  /** The pinned header re-rendered after a change. */
  | "header"
  | "update"
  | "note"
  /** The living announcement, posted or edited in place. */
  | "announcement"
  /** A direct message that pages someone. */
  | "page"
  | "invite"
  | "test"
  | "alert"
  /** The root cause analysis, posted or updated in place. */
  | "rca"
  /** "Atlas acted" — an autonomous action told to the channel. */
  | "atlas"
  /** An update draft by Atlas, waiting for a person to publish it. */
  | "draft"
  /** Inbound: a command typed in the chat tool. */
  | "command"
  /** Inbound: a message pinned to the timeline. */
  | "pin"
  /** A member looked up by email — found or not. */
  | "lookup"
  /** The workspace paired or installed. */
  | "install";

export const chatEvents = app.table(
  "chat_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider").$type<ChatProvider>().notNull(),
    /** out: Open Incident spoke; in: someone acted from the chat tool. */
    direction: text("direction").$type<"out" | "in">().notNull().default("out"),
    kind: text("kind").$type<ChatEventKind>().notNull(),
    /** Where: a channel as people read it (#inc-220, Incidents › Ops) or a person's name. */
    target: text("target"),
    /** What, when the kind needs it: the command typed, the person invited, the subject paged. */
    detail: text("detail"),
    status: text("status").$type<"delivered" | "failed">().notNull().default("delivered"),
    /** The provider's own error code (user_disabled, not_in_team…), shown as it came. */
    error: text("error"),
    incidentId: uuid("incident_id").references(() => incidents.id, { onDelete: "set null" }),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    /** Kind-specific facts: the message reference, an edit in place, an acknowledgement. */
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_events_tenant_time").on(t.tenantId, t.provider, t.createdAt)],
);
