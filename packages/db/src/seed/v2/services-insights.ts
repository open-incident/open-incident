/**
 * Demo rows the V2 design shows for services-insights — idempotent: running it twice
 * leaves the same rows. Called by the demo seed and by `run.ts --part services-insights`.
 * Owner: services-insights.
 *
 * What it builds, on the demo's real services and members:
 *  - the services' labels in the short form the design reads (`tier:1`,
 *    `env:production`, `repo:skylark/checkout-api`) — only where the old long
 *    form is still there, so a label somebody edited is left alone;
 *  - the names the traces use and no alert ever did: `storefront`,
 *    `search-api`, `notify-fanout`, `orders-db`. Ingestion would have created
 *    them the first time a span named them; the telemetry demo writes its
 *    spans straight into the column store, so they are created here, as
 *    ingestion would have. `storefront` is merged into `web-storefront` (one
 *    service, two names); the other three wait in "Seen in traffic";
 *  - one dependency a person confirmed: checkout-api → payments-worker;
 *  - six months of pages on the Platform policy, at the hours people really
 *    get paged, so Pager load has a period and a previous one to compare —
 *    and one responder carrying most of the nights.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  escalationPathVersions,
  escalationPaths,
  escalations,
  members,
  notificationDeliveries,
  services,
} from "../../schema/app";
import { serviceLinks } from "../../schema/service-links";
import type { SeedTx } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A UUID derived from the workspace and a key — the same on every run. */
function sid(tenantId: string, key: string): string {
  const h = createHash("sha256").update(`services-insights:${tenantId}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A small deterministic generator: the same "random" pages on every run. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const SHORT_LABELS: Record<string, Record<string, string>> = {
  "checkout-api": { tier: "1", env: "production", repo: "skylark/checkout-api" },
  "payments-worker": { tier: "1", env: "production", repo: "skylark/payments" },
  "web-storefront": { tier: "2", env: "production", repo: "skylark/storefront" },
  "auth-service": { tier: "1", env: "production", repo: "skylark/auth" },
};

const TRACE_NAMES = ["storefront", "search-api", "notify-fanout", "orders-db"] as const;

export async function seed(tx: SeedTx, tenantId: string): Promise<void> {
  await labels(tx, tenantId);
  await traceNames(tx, tenantId);
  await confirmedLink(tx, tenantId);
  await pagerHistory(tx, tenantId);
}

async function labels(tx: SeedTx, tenantId: string) {
  const rows: Array<{ id: string; key: string; labels: Record<string, string> }> = await tx
    .select({ id: services.id, key: services.key, labels: services.labels })
    .from(services)
    .where(and(eq(services.tenantId, tenantId), inArray(services.key, Object.keys(SHORT_LABELS))));
  for (const r of rows) {
    if (!("repository" in r.labels) && !("environments" in r.labels)) continue;
    await tx
      .update(services)
      .set({ labels: SHORT_LABELS[r.key]!, updatedAt: new Date() })
      .where(eq(services.id, r.id));
  }
}

async function traceNames(tx: SeedTx, tenantId: string) {
  const now = Date.now();
  for (const [i, key] of TRACE_NAMES.entries()) {
    await tx
      .insert(services)
      .values({
        id: sid(tenantId, `service:${key}`),
        tenantId,
        key,
        seenIn: ["telemetry"],
        firstSeenAt: new Date(now - (24 - i) * DAY),
        telemetryFirstSeenAt: new Date(now - (24 - i) * DAY),
        telemetryLastSeenAt: new Date(now - (2 + i) * MIN),
      })
      .onConflictDoNothing({ target: [services.tenantId, services.key] });
  }
  // `storefront` and `web-storefront` are one service: the traces call it one
  // thing, the alerts the other.
  const [web] = await tx
    .select({ id: services.id, ownerTeamId: services.ownerTeamId })
    .from(services)
    .where(and(eq(services.tenantId, tenantId), eq(services.key, "web-storefront")));
  if (web) {
    await tx
      .update(services)
      .set({ mergedIntoId: web.id, ownerTeamId: web.ownerTeamId, confirmed: true })
      .where(
        and(
          eq(services.tenantId, tenantId),
          eq(services.key, "storefront"),
          sql`${services.mergedIntoId} is null`,
        ),
      );
  }
}

async function confirmedLink(tx: SeedTx, tenantId: string) {
  const rows: Array<{ id: string; key: string }> = await tx
    .select({ id: services.id, key: services.key })
    .from(services)
    .where(
      and(
        eq(services.tenantId, tenantId),
        inArray(services.key, ["checkout-api", "payments-worker"]),
      ),
    );
  const from = rows.find((r) => r.key === "checkout-api");
  const to = rows.find((r) => r.key === "payments-worker");
  if (!from || !to) return;
  await tx
    .insert(serviceLinks)
    .values({ tenantId, fromServiceId: from.id, toServiceId: to.id, state: "declared" })
    .onConflictDoNothing({
      target: [serviceLinks.tenantId, serviceLinks.fromServiceId, serviceLinks.toServiceId],
    });
}

/**
 * Pages over the last 180 days, Europe/Paris hours: mostly working hours, a
 * few evenings, and one responder — Lucas — taking the nights. The previous
 * 90 days carry a little more load than the current ones, so the comparison
 * says something. Every row is recognisable (its trigger name) and rewritten
 * as a whole on each run.
 */
async function pagerHistory(tx: SeedTx, tenantId: string) {
  const MARK = "seed:pager-history";
  const people: Array<{ id: string; email: string }> = await tx
    .select({ id: members.id, email: members.email })
    .from(members)
    .where(eq(members.tenantId, tenantId));
  const byEmail = (local: string) => people.find((p) => p.email.split("@")[0] === local)?.id;
  const cast = [
    { id: byEmail("karim"), day: 22, evening: 2, night: 0 },
    { id: byEmail("nadia"), day: 12, evening: 2, night: 1 },
    { id: byEmail("thomas"), day: 9, evening: 1, night: 0 },
    { id: byEmail("lucas"), day: 6, evening: 3, night: 6 },
  ].filter((c): c is { id: string; day: number; evening: number; night: number } => !!c.id);
  if (cast.length === 0) return;

  const [path] = await tx
    .select({ id: escalationPaths.id })
    .from(escalationPaths)
    .where(
      and(eq(escalationPaths.tenantId, tenantId), eq(escalationPaths.name, "Platform primary")),
    );
  if (!path) return;
  const [version] = await tx
    .select({ id: escalationPathVersions.id })
    .from(escalationPathVersions)
    .where(eq(escalationPathVersions.pathId, path.id))
    .orderBy(sql`${escalationPathVersions.version} desc`)
    .limit(1);
  if (!version) return;

  // Rewritten whole: what a previous run wrote goes first.
  const old: Array<{ id: string }> = await tx
    .select({ id: escalations.id })
    .from(escalations)
    .where(and(eq(escalations.tenantId, tenantId), eq(escalations.triggeredByName, MARK)));
  if (old.length > 0) {
    const ids = old.map((o) => o.id);
    await tx
      .delete(notificationDeliveries)
      .where(inArray(notificationDeliveries.escalationId, ids));
    await tx.delete(escalations).where(inArray(escalations.id, ids));
  }

  const rand = prng(20261018);
  // Midnight, Paris, today — pages are placed on whole local days before it.
  const today = new Date();
  const parisOffset = (d: Date) => {
    const local = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
    const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
    return local.getTime() - utc.getTime();
  };
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const at = (daysAgo: number, hour: number, minute: number) => {
    const local = midnight - daysAgo * DAY + hour * HOUR + minute * MIN;
    return new Date(local - parisOffset(new Date(local)));
  };

  const esc: Array<typeof escalations.$inferInsert> = [];
  const del: Array<typeof notificationDeliveries.$inferInsert> = [];
  let n = 0;
  for (const window of [
    { from: 2, to: 90, scale: 1 },
    { from: 91, to: 180, scale: 1.2 },
  ]) {
    for (const p of cast) {
      const slots: Array<[number, number]> = [];
      const push = (count: number, hours: number[]) => {
        for (let i = 0; i < Math.round(count * window.scale); i++)
          slots.push([
            window.from + Math.floor(rand() * (window.to - window.from)),
            hours[Math.floor(rand() * hours.length)]!,
          ]);
      };
      push(p.day, [9, 10, 11, 14, 15, 16, 17]);
      push(p.evening, [19, 21, 22, 23]);
      push(window.scale > 1 ? Math.max(0, p.night - 2) : p.night, [0, 1, 2, 3, 5]);
      for (const [daysAgo, hour] of slots) {
        const started = at(daysAgo, hour, Math.floor(rand() * 60));
        const ackMin = 1 + Math.floor(rand() * (hour < 7 ? 9 : 5));
        const acked = new Date(started.getTime() + ackMin * MIN + Math.floor(rand() * 50) * 1000);
        const id = sid(tenantId, `page:${n++}`);
        esc.push({
          id,
          tenantId,
          pathId: path.id,
          pathVersionId: version.id,
          status: "resolved",
          urgency: "high",
          startedAt: started,
          endedAt: new Date(acked.getTime() + 25 * MIN),
          ackedByMemberId: p.id,
          ackedAt: acked,
          ackedChannel: "voice",
          ackedMemberIds: [p.id],
          triggeredByKind: "system",
          triggeredByName: MARK,
          isTest: false,
          createdAt: started,
        });
        del.push({
          tenantId,
          memberId: p.id,
          methodKind: "voice",
          target: "voice",
          kind: "escalation",
          urgency: "high",
          escalationId: id,
          status: "handled",
          message: { text: "", subject: "" },
          sendAfter: started,
          createdAt: started,
          sentAt: started,
          deliveredAt: new Date(started.getTime() + 4000),
          handledAt: acked,
        });
      }
    }
  }
  for (let i = 0; i < esc.length; i += 200)
    await tx.insert(escalations).values(esc.slice(i, i + 200));
  for (let i = 0; i < del.length; i += 200)
    await tx.insert(notificationDeliveries).values(del.slice(i, i + 200));
}
