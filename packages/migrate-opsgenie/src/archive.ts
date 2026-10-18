/**
 * Step 7: the alert history, kept here read-only.
 *
 * Read window by window (each under Opsgenie's 20 000-alert search ceiling),
 * a page of 100 at a time, then each alert's details one by one at the pace
 * Opsgenie allows. Every page is written before the next is asked for, and
 * the cursor with it: an interrupted archive resumes where it stopped.
 *
 * The alerts land in the product's own alert table, on a managed source that
 * is switched off ("Opsgenie history") — so Insights, Services and similar-
 * incident search read them like any other, and nothing can ever post to it.
 * An alert still open in Opsgenie is not copied: it is still Opsgenie's.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { alertPriorities, alertSources, alerts, type Tx } from "@openincident/db";
import { windowQuery, type OpsgenieClient } from "./client";
import { isNobody, type PeopleIndex } from "./convert";
import type { OgAlert } from "./types";
import { planWindows, type ArchiveWindow } from "./windows";

export const HISTORY_SOURCE_NAME = "Opsgenie history";
const PAGE = 100;

export type ArchiveCursor = {
  windows: ArchiveWindow[];
  total: number;
  imported: number;
  skipped: number;
  startedAt: string;
  finishedAt?: string | null;
};

export async function ensureHistorySource(tx: Tx, tenantId: string): Promise<string> {
  const [existing] = await tx
    .select({ id: alertSources.id })
    .from(alertSources)
    .where(
      and(
        eq(alertSources.tenantId, tenantId),
        eq(alertSources.managed, true),
        eq(alertSources.name, HISTORY_SOURCE_NAME),
      ),
    );
  if (existing) return existing.id;
  const [row] = await tx
    .insert(alertSources)
    .values({
      tenantId,
      kind: "http",
      name: HISTORY_SOURCE_NAME,
      description: "Alerts archived from Opsgenie. Read-only: nothing posts here.",
      // A secret nobody holds: the source is switched off and managed by the product.
      secretHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      managed: true,
      active: false,
      escalations: [],
      incidentOpens: "never",
    })
    .returning({ id: alertSources.id });
  return row!.id;
}

/** The windows to read, from the oldest alert to now (network). */
export async function planArchive(
  client: OpsgenieClient,
  oldest: Date,
  now: Date,
): Promise<ArchiveCursor> {
  const windows = await planWindows(client, oldest, now);
  return {
    windows,
    total: windows.reduce((n, w) => n + w.count, 0),
    imported: 0,
    skipped: 0,
    startedAt: now.toISOString(),
    finishedAt: null,
  };
}

/**
 * One page of the current window, with each alert's details (network).
 * Returns null when every window is done.
 */
export async function fetchPage(
  client: OpsgenieClient,
  cursor: ArchiveCursor,
): Promise<{ index: number; alerts: OgAlert[]; listed: number } | null> {
  const index = cursor.windows.findIndex((w) => !w.done);
  if (index < 0) return null;
  const w = cursor.windows[index]!;
  const page = await client.searchAlerts(
    windowQuery(new Date(w.from), new Date(w.to)),
    w.offset,
    Math.min(PAGE, 20_000 - w.offset),
    "asc",
  );
  const detailed: OgAlert[] = [];
  for (const a of page) detailed.push(await client.alert(a.id).catch(() => a));
  return { index, alerts: detailed, listed: page.length };
}

/** Moves the cursor past a page that was stored. */
export function advanceCursor(
  cursor: ArchiveCursor,
  index: number,
  listed: number,
  stored: { imported: number; skipped: number },
): ArchiveCursor {
  const windows = cursor.windows.map((w, i) => {
    if (i !== index) return w;
    const offset = w.offset + listed;
    return {
      ...w,
      offset,
      imported: w.imported + stored.imported,
      skipped: w.skipped + stored.skipped,
      done: listed < PAGE || offset >= w.count || offset >= 20_000,
    };
  });
  const finished = windows.every((w) => w.done);
  return {
    ...cursor,
    windows,
    imported: cursor.imported + stored.imported,
    skipped: cursor.skipped + stored.skipped,
    finishedAt: finished ? new Date().toISOString() : null,
  };
}

const serviceOf = (a: OgAlert): string | null =>
  a.details?.service ??
  a.tags?.find((t) => t.startsWith("service:"))?.slice("service:".length) ??
  a.entity ??
  null;

/** Writes a page of Opsgenie alerts as resolved alerts of the history source. */
export async function storeAlerts(
  tx: Tx,
  tenantId: string,
  sourceId: string,
  page: OgAlert[],
  ctx: {
    people: PeopleIndex;
    usersByUsername: Map<string, string>;
    teamNames: Map<string, string>;
  },
): Promise<{ imported: number; skipped: number }> {
  if (!page.length) return { imported: 0, skipped: 0 };
  const prios = await tx
    .select()
    .from(alertPriorities)
    .where(eq(alertPriorities.tenantId, tenantId));
  const byName = (name: string) =>
    prios.find((p) => p.name.toLowerCase() === name.toLowerCase()) ??
    prios.find((p) => p.aliases.some((x) => x.toLowerCase() === name.toLowerCase())) ??
    prios.slice().sort((a, b) => b.rank - a.rank)[0] ??
    null;
  const keys = page.map((a) => `opsgenie:${a.id}`);
  const already = new Set(
    (
      await tx
        .select({ k: alerts.dedupKey })
        .from(alerts)
        .where(and(eq(alerts.sourceId, sourceId), inArray(alerts.dedupKey, keys)))
    ).map((r) => r.k),
  );
  const rows: Array<typeof alerts.$inferInsert> = [];
  let skipped = 0;
  for (const a of page) {
    const key = `opsgenie:${a.id}`;
    if (already.has(key)) continue;
    const closeMs = a.report?.closeTime;
    if (a.status !== "closed" || !closeMs) {
      skipped++;
      continue;
    }
    const created = new Date(a.createdAt);
    const prio = byName(a.priority === "P5" ? "P4" : a.priority);
    const team = a.teams?.[0]?.id ? ctx.teamNames.get(a.teams[0].id) : undefined;
    const ackerUser = a.report?.acknowledgedBy
      ? ctx.usersByUsername.get(a.report.acknowledgedBy.toLowerCase())
      : undefined;
    const acker = ackerUser ? ctx.people.get(ackerUser) : null;
    const service = serviceOf(a);
    const attributes: Record<string, string> = {};
    if (service) attributes.service = service;
    if (a.details?.environment) attributes.environment = a.details.environment;
    if (team) attributes.team = team;
    if (prio) attributes.priority = prio.name;
    rows.push({
      tenantId,
      sourceId,
      dedupKey: key,
      status: "resolved",
      title: a.message.slice(0, 500),
      description: a.description ?? null,
      payload: a,
      attributes,
      priorityId: prio?.id ?? null,
      urgency: prio?.urgency ?? null,
      groupCount: Math.max(1, a.count ?? 1),
      firstAt: created,
      lastAt: a.lastOccurredAt ? new Date(a.lastOccurredAt) : created,
      resolvedAt: new Date(created.getTime() + closeMs),
      ackedAt: a.report?.ackTime ? new Date(created.getTime() + a.report.ackTime) : null,
      ackedByMemberId: acker && !isNobody(acker) ? acker : null,
      createdAt: created,
    });
  }
  if (rows.length) await tx.insert(alerts).values(rows);
  return { imported: rows.length, skipped };
}
