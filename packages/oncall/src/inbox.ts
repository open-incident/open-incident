/**
 * The bell — one writer.
 *
 * The product already knows how to reach someone outside itself: email, SMS,
 * voice, push, Slack, Teams, all recorded in `notification_deliveries`. What
 * it had nowhere to put was "this concerns you, in the app, read or unread".
 * That is this table, and this is the only function that writes to it.
 *
 * Two rules keep it from becoming a second alerting channel:
 *
 * - It never sends anything. A badge does not wake anyone up. What wakes
 *   people up stays the escalation policy; the bell tells the story
 *   afterwards.
 * - The same `groupKey` writes the same row again rather than a new one: the
 *   count grows, the wording is refreshed, and the row comes back unread.
 *   Ten events on one incident are one line that says ten.
 *
 * It never throws either. A notification that fails to be recorded must not
 * take down the gesture that produced it.
 */

import { sql } from "drizzle-orm";
import { memberNotifications, type Tx } from "@openincident/db";

export type InboxKind = "paged" | "incident" | "follow_up" | "mention";

export type InboxInput = {
  kind: InboxKind;
  /** One line, already in the reader's words — no key, no template. */
  title: string;
  body?: string | null;
  /** Relative, so it survives a workspace changing its domain. */
  url?: string | null;
  incidentId?: string | null;
  alertId?: string | null;
  /**
   * What collapses. Same key, same row. Default it to the object the line is
   * about — `incident:<id>` — so a noisy incident stays one line.
   */
  groupKey: string;
};

/** Records one line in a member's bell. Returns false when it could not. */
export async function recordInbox(
  tx: Tx,
  tenantId: string,
  memberId: string,
  input: InboxInput,
): Promise<boolean> {
  try {
    await tx
      .insert(memberNotifications)
      .values({
        tenantId,
        memberId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        url: input.url ?? null,
        incidentId: input.incidentId ?? null,
        alertId: input.alertId ?? null,
        groupKey: input.groupKey,
      })
      .onConflictDoUpdate({
        target: [
          memberNotifications.tenantId,
          memberNotifications.memberId,
          memberNotifications.groupKey,
        ],
        set: {
          title: input.title,
          body: input.body ?? null,
          url: input.url ?? null,
          kind: input.kind,
          count: sql`${memberNotifications.count} + 1`,
          // News again: a line that comes back is a line to read again.
          readAt: null,
          updatedAt: new Date(),
        },
      });
    return true;
  } catch (err) {
    console.error("[inbox] could not record:", err);
    return false;
  }
}
