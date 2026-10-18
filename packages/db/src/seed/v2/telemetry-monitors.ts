/**
 * Demo rows the V2 design shows for telemetry-monitors — idempotent: running it
 * twice leaves the same rows. Called by the demo seed and by
 * `run.ts --part telemetry-monitors`. Owner: telemetry-monitors.
 *
 * The demo monitors carry 48 checks each, which is three quarters of an hour:
 * enough for a list, not for the design's charts over a day, a week, thirty
 * days. So the two web monitors get the thirty days of raw checks the screen
 * reads — one per minute, up to the moment the demo paused them — with what a
 * timed HTTP check records beside the latency: the four phases and the
 * certificate. One afternoon carries a slow spell, as the design's does, and
 * the day rollup is moved by exactly the seconds those checks represent, so
 * the uptime figure and the bars still agree with the checks.
 *
 * Nothing here reaches out: the monitors stay paused, as the demo explains.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  changeEvents,
  incidents,
  monitorChecks,
  monitorDays,
  monitors,
  services,
} from "../../schema/app";
import type { SeedTx } from "./types";

const MARK = "v2-telemetry-monitors";
const DAY = 86_400_000;

/** Deterministic noise, so two seeds draw the same chart. */
function noise(i: number, seed: number): number {
  const j = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return j - Math.floor(j) - 0.5;
}

type Plan = {
  name: string;
  base: number;
  /** A slow spell, in minutes before the pause: [start, end]. */
  spell?: [number, number];
  /** Of those, the minutes that failed outright. */
  failed?: number[];
  validTo: string;
  issuer: string;
};

const PLANS: Plan[] = [
  {
    name: "Checkout — /health",
    base: 84,
    spell: [7 * 60 + 13, 7 * 60],
    failed: [7 * 60 + 9, 7 * 60 + 6, 7 * 60 + 4],
    validTo: "2026-12-18T09:12:00.000Z",
    issuer: "Let's Encrypt",
  },
  {
    name: "Storefront — home page",
    base: 205,
    spell: [26 * 60 + 40, 26 * 60 + 22],
    validTo: "2027-01-09T11:40:00.000Z",
    issuer: "Let's Encrypt",
  },
];

/**
 * The deploy the charts mark. INC-220 (payments webhooks late) opened with no
 * change recorded on payments-worker, so its charts had nothing to put a
 * marker on; the deploy that preceded it is written six minutes before the
 * declaration, as the design's CHG-92 is.
 */
async function deployBeforeInc220(tx: SeedTx, tenantId: string): Promise<void> {
  const title = "payments-worker v2.32 — pool settings";
  const [present] = await tx
    .select({ id: changeEvents.id })
    .from(changeEvents)
    .where(and(eq(changeEvents.tenantId, tenantId), eq(changeEvents.title, title)));
  if (present) return;
  const [inc] = await tx
    .select({ declaredAt: incidents.declaredAt, serviceId: incidents.serviceId })
    .from(incidents)
    .innerJoin(services, eq(services.id, incidents.serviceId))
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        eq(incidents.number, 220),
        eq(services.key, "payments-worker"),
      ),
    );
  if (!inc) return;
  await tx.insert(changeEvents).values({
    tenantId,
    kind: "deploy",
    title,
    description: "Rolling deploy, 6 replicas. DB_POOL_MAX unchanged at 20.",
    environment: "production",
    actorName: "github-actions",
    externalRef: "https://github.com/skylark/payments-worker/actions/runs/10342",
    occurredAt: new Date(inc.declaredAt.getTime() - 6 * 60_000),
    serviceId: inc.serviceId,
  });
}

export async function seed(tx: SeedTx, tenantId: string): Promise<void> {
  await deployBeforeInc220(tx, tenantId);

  const rows: Array<{
    id: string;
    name: string;
    intervalSeconds: number;
    lastCheckAt: Date | null;
    criteria: Array<{ on: string; op: string; value: string; then: string }>;
  }> = await tx
    .select({
      id: monitors.id,
      name: monitors.name,
      intervalSeconds: monitors.intervalSeconds,
      lastCheckAt: monitors.lastCheckAt,
      criteria: monitors.criteria,
    })
    .from(monitors)
    .where(
      and(
        eq(monitors.tenantId, tenantId),
        inArray(
          monitors.name,
          PLANS.map((p) => p.name),
        ),
      ),
    );

  for (const plan of PLANS) {
    const m = rows.find((r) => r.name === plan.name);
    if (!m || !m.lastCheckAt) continue;
    const [done] = await tx.execute(
      sql`select 1 from app.monitor_checks where monitor_id = ${m.id} and result->>'seed' = ${MARK}::text limit 1`,
    );
    if (done) continue;

    const every = m.intervalSeconds * 1000;
    const end = m.lastCheckAt.getTime();
    const slowAt =
      Number(
        m.criteria.find((c) => c.on === "response_time_ms" && c.then === "degraded")?.value ?? 2000,
      ) || 2000;
    const tls = { validTo: plan.validTo, issuer: plan.issuer };

    // The checks the demo already wrote (the last 48) learn their phases too.
    await tx.execute(sql`
      update app.monitor_checks
         set result = jsonb_build_object(
               'kind', 'http',
               'seed', ${MARK}::text,
               'phases', jsonb_build_object(
                 'dns', 8 + (extract(minute from at)::int % 4),
                 'connect', 19 + (extract(minute from at)::int % 5),
                 'tls', 34 + (extract(minute from at)::int % 7),
                 'firstByte', greatest(1, latency_ms - 61 - (extract(minute from at)::int % 16))),
               'tls', ${JSON.stringify(tls)}::jsonb)
       where monitor_id = ${m.id} and result is null`);

    // Thirty days of minutes before the earliest of those.
    const [{ first }] = await tx.execute(
      sql`select min(at) as first from app.monitor_checks where monitor_id = ${m.id}`,
    );
    const from = end - 30 * DAY;
    const until = new Date(first).getTime() - every;
    const batch: Array<typeof monitorChecks.$inferInsert> = [];
    const degradedByDay = new Map<string, number>();
    const offlineByDay = new Map<string, number>();
    const flush = async () => {
      if (batch.length) await tx.insert(monitorChecks).values(batch.splice(0, batch.length));
    };
    let i = 0;
    for (let at = until; at >= from; at -= every, i++) {
      const minutesBefore = Math.round((end - at) / 60_000);
      const inSpell =
        !!plan.spell && minutesBefore <= plan.spell[0] && minutesBefore >= plan.spell[1];
      const failed = plan.failed?.includes(minutesBefore) ?? false;
      // A daily rhythm, a little noise, and the spell: first byte climbs,
      // the handshake does not — the server was slow, not the network.
      const hour = new Date(at).getUTCHours();
      const daily = 1 + 0.14 * Math.sin(((hour - 9) / 24) * Math.PI * 2);
      const dns = Math.max(2, Math.round(9 + 3 * noise(i, 3)));
      const connect = Math.max(4, Math.round(21 + 4 * noise(i, 5)));
      const handshake = Math.max(10, Math.round(38 + 6 * noise(i, 7)));
      let firstByte = Math.max(
        5,
        Math.round((plan.base - 68) * daily * (1 + 0.35 * noise(i, 11)) + 4 * noise(i, 13)),
      );
      if (inSpell) {
        const depth = Math.min(minutesBefore - plan.spell![1], plan.spell![0] - minutesBefore) + 1;
        firstByte += Math.round(Math.min(1, depth / 3) * (slowAt * 1.1 + 180 * noise(i, 17)));
      }
      const latency = dns + connect + handshake + firstByte;
      const state = failed ? "offline" : latency > slowAt ? "degraded" : "online";
      const day = new Date(at).toISOString().slice(0, 10);
      if (state === "degraded")
        degradedByDay.set(day, (degradedByDay.get(day) ?? 0) + m.intervalSeconds);
      if (state === "offline")
        offlineByDay.set(day, (offlineByDay.get(day) ?? 0) + m.intervalSeconds);
      batch.push({
        tenantId,
        monitorId: m.id,
        at: new Date(at),
        state,
        latencyMs: failed ? 10_000 : latency,
        detail: failed
          ? "timeout after 10000 ms"
          : state === "degraded"
            ? `200 in ${(latency / 1000).toFixed(1)} s`
            : `200 in ${latency} ms`,
        result: failed
          ? { kind: "http", seed: MARK }
          : {
              kind: "http",
              seed: MARK,
              phases: { dns, connect, tls: handshake, firstByte },
              tls,
            },
      });
      if (batch.length >= 2000) await flush();
    }
    await flush();

    // The rollup follows the checks: the seconds the spell took move from
    // online to degraded or offline on the day they happened.
    for (const [day, seconds] of degradedByDay) {
      await tx
        .update(monitorDays)
        .set({
          degradedSeconds: sql`${monitorDays.degradedSeconds} + ${seconds}`,
          onlineSeconds: sql`greatest(0, ${monitorDays.onlineSeconds} - ${seconds})`,
        })
        .where(and(eq(monitorDays.monitorId, m.id), eq(monitorDays.day, day)));
    }
    for (const [day, seconds] of offlineByDay) {
      await tx
        .update(monitorDays)
        .set({
          offlineSeconds: sql`${monitorDays.offlineSeconds} + ${seconds}`,
          onlineSeconds: sql`greatest(0, ${monitorDays.onlineSeconds} - ${seconds})`,
        })
        .where(and(eq(monitorDays.monitorId, m.id), eq(monitorDays.day, day)));
    }
  }
}
