/**
 * The bell — the read side, and the writers that are not a page.
 *
 * `recordInbox` (in @openincident/oncall) is the only function that writes a
 * row. This file gives the screens what they read, and wraps the three product
 * gestures that put a line there without paging anyone: an incident someone is
 * on moved, a follow-up landed on them, someone named them in a post-mortem.
 *
 * None of it ever throws. A line in the bell is a courtesy; it must not be
 * able to fail the gesture that produced it.
 */

import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  incidents,
  incidentParticipants,
  memberNotifications,
  members,
  withTenant,
  workspaces,
  type Tx,
} from "@openincident/db";
import { recordInbox } from "@openincident/oncall";
import { buildTranslate, type Translate } from "@/i18n/server";
import { resolveLocale } from "@/i18n/locales";

export type InboxRow = {
  id: string;
  kind: "paged" | "incident" | "follow_up" | "mention";
  title: string;
  body: string | null;
  url: string | null;
  count: number;
  readAt: Date | null;
  createdAt: Date;
};

const PANEL_SIZE = 20;

export async function listInbox(
  tx: Tx,
  tenantId: string,
  memberId: string,
  limit = PANEL_SIZE,
): Promise<InboxRow[]> {
  return tx
    .select({
      id: memberNotifications.id,
      kind: memberNotifications.kind,
      title: memberNotifications.title,
      body: memberNotifications.body,
      url: memberNotifications.url,
      count: memberNotifications.count,
      readAt: memberNotifications.readAt,
      createdAt: memberNotifications.createdAt,
    })
    .from(memberNotifications)
    .where(
      and(eq(memberNotifications.tenantId, tenantId), eq(memberNotifications.memberId, memberId)),
    )
    .orderBy(desc(memberNotifications.createdAt))
    .limit(limit);
}

export async function unreadInbox(tx: Tx, tenantId: string, memberId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(memberNotifications)
    .where(
      and(
        eq(memberNotifications.tenantId, tenantId),
        eq(memberNotifications.memberId, memberId),
        isNull(memberNotifications.readAt),
      ),
    );
  return row?.n ?? 0;
}

/** Marks one line, or every unread line, as read. */
export async function markInboxRead(
  tx: Tx,
  tenantId: string,
  memberId: string,
  id?: string,
): Promise<void> {
  const where = id
    ? and(
        eq(memberNotifications.tenantId, tenantId),
        eq(memberNotifications.memberId, memberId),
        eq(memberNotifications.id, id),
      )
    : and(
        eq(memberNotifications.tenantId, tenantId),
        eq(memberNotifications.memberId, memberId),
        isNull(memberNotifications.readAt),
      );
  await tx.update(memberNotifications).set({ readAt: new Date() }).where(where);
}

/**
 * Who should hear about an incident: everyone the incident already records as
 * being on it — participants and observers — minus whoever caused the change.
 * Telling people what they just did themselves is the noise that makes a bell
 * get ignored.
 */
async function audienceOf(
  tx: Tx,
  tenantId: string,
  incidentId: string,
  exceptMemberId: string | null,
): Promise<string[]> {
  const rows = await tx
    .select({ memberId: incidentParticipants.memberId })
    .from(incidentParticipants)
    .where(
      and(
        eq(incidentParticipants.tenantId, tenantId),
        eq(incidentParticipants.incidentId, incidentId),
      ),
    );
  const ids = new Set<string>();
  for (const r of rows) if (r.memberId !== exceptMemberId) ids.add(r.memberId);
  return [...ids];
}

/**
 * A line is written in the language of the person who will read it, not of the
 * person who caused it. A translator is built once per language in play, which
 * for almost every workspace means once.
 */
async function readersOf(
  tx: Tx,
  tenantId: string,
  memberIds: string[],
): Promise<Array<{ id: string; t: Translate }>> {
  if (memberIds.length === 0) return [];
  const [ws] = await tx
    .select({ locale: workspaces.locale, timezone: workspaces.timezone })
    .from(workspaces)
    .where(eq(workspaces.tenantId, tenantId));
  const rows = await tx
    .select({ id: members.id, locale: members.locale })
    .from(members)
    .where(and(eq(members.tenantId, tenantId), inArray(members.id, memberIds)));
  const cache = new Map<string, Translate>();
  return rows.map((m) => {
    const code = m.locale ?? ws?.locale ?? "en";
    let t = cache.get(code);
    if (!t) {
      t = buildTranslate(resolveLocale(code), ws?.timezone ?? "Europe/Paris");
      cache.set(code, t);
    }
    return { id: m.id, t };
  });
}

/** What an incident line can say. Keys, so each reader gets their own words. */
export type IncidentWhat =
  "bell.what.declared" | "bell.what.updated" | "bell.what.updatePublished" | "bell.what.resolved";

/**
 * An incident someone is on has moved. One line per person, collapsing on the
 * incident: an hour of updates is one line that counts them.
 */
export async function inboxIncidentChanged(
  tenantId: string,
  incidentId: string,
  what: IncidentWhat,
  byMemberId: string | null,
): Promise<void> {
  try {
    await withTenant(tenantId, async (tx) => {
      const [inc] = await tx
        .select({ number: incidents.number, name: incidents.name })
        .from(incidents)
        .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)));
      if (!inc) return;
      const audience = await audienceOf(tx, tenantId, incidentId, byMemberId);
      for (const reader of await readersOf(tx, tenantId, audience)) {
        await recordInbox(tx, tenantId, reader.id, {
          kind: "incident",
          title: `INC-${inc.number} · ${inc.name}`,
          body: reader.t(what),
          url: `/app/incidents/${inc.number}`,
          incidentId,
          groupKey: `incident:${incidentId}`,
        });
      }
    });
  } catch (err) {
    console.error("[inbox] incident line failed:", err);
  }
}

/** A follow-up was assigned to someone. */
export async function inboxFollowUpAssigned(
  tx: Tx,
  tenantId: string,
  input: {
    assigneeMemberId: string;
    byMemberId: string | null;
    incidentId: string;
    incidentNumber: number;
    title: string;
    followUpId: string;
  },
): Promise<void> {
  if (input.assigneeMemberId === input.byMemberId) return;
  await recordInbox(tx, tenantId, input.assigneeMemberId, {
    kind: "follow_up",
    title: input.title,
    body: `INC-${input.incidentNumber}`,
    url: `/app/incidents/${input.incidentNumber}?tab=post-incident`,
    incidentId: input.incidentId,
    groupKey: `follow_up:${input.followUpId}`,
  });
}

/**
 * Someone was named in a post-mortem comment. Names are matched against the
 * workspace's members, so an `@` that matches nobody quietly matches nobody —
 * the product does not invent a recipient.
 */
export async function inboxMentions(
  tx: Tx,
  tenantId: string,
  input: {
    text: string;
    byMemberId: string | null;
    byName: string;
    incidentId: string;
    incidentNumber: number;
  },
): Promise<void> {
  const handles = [...input.text.matchAll(/@([\w.-]{2,60})/g)].map((m) => m[1]!.toLowerCase());
  if (handles.length === 0) return;
  const roster = await tx
    .select({ id: members.id, name: members.name, email: members.email })
    .from(members)
    .where(
      and(
        eq(members.tenantId, tenantId),
        input.byMemberId ? ne(members.id, input.byMemberId) : undefined,
      ),
    );
  const hit = new Set<string>();
  for (const m of roster) {
    const local = m.email.split("@")[0]?.toLowerCase() ?? "";
    const slug = m.name.toLowerCase().replace(/\s+/g, ".");
    if (handles.some((h) => h === local || h === slug)) hit.add(m.id);
  }
  for (const reader of await readersOf(tx, tenantId, [...hit])) {
    await recordInbox(tx, tenantId, reader.id, {
      kind: "mention",
      title: reader.t("bell.mentionedYou", { name: input.byName }),
      body: input.text.slice(0, 200),
      url: `/app/incidents/${input.incidentNumber}?tab=post-incident`,
      incidentId: input.incidentId,
      groupKey: `mention:${input.incidentId}:${input.byMemberId ?? "system"}`,
    });
  }
}

/** Ninety days, like the mail log. The bell tells a story, it does not archive one. */
export async function purgeInbox(tx: Tx, tenantId: string, before: Date): Promise<void> {
  await tx
    .delete(memberNotifications)
    .where(
      and(
        eq(memberNotifications.tenantId, tenantId),
        sql`${memberNotifications.createdAt} < ${before}`,
      ),
    );
}

/** Used by the shell to read badge and panel in one pass. */
export async function inboxForShell(
  tx: Tx,
  tenantId: string,
  memberId: string,
): Promise<{ rows: InboxRow[]; unread: number }> {
  const rows = await listInbox(tx, tenantId, memberId);
  const unread = rows.filter((r) => !r.readAt).length;
  // The panel holds twenty; beyond that the badge still has to be right.
  if (rows.length < PANEL_SIZE) return { rows, unread };
  return { rows, unread: await unreadInbox(tx, tenantId, memberId) };
}
