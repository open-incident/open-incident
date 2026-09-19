/**
 * What the alert pipeline costs per alert, and where.
 *
 * Below HTTP on purpose: the question is what grouping, routing, paging and
 * the incident decision cost, not what Next.js adds around them. Every alert
 * is sent in test mode, so the whole path runs and pages nobody.
 */
import { withTenant, alertSources, getTenantBySlug, alerts } from "@openincident/db";
import { and, eq, like } from "drizzle-orm";
import { ingestPayload } from "../src/lib/alert-ingest";

async function main() {
  const TOTAL = Number(process.env.ALERTS ?? 120);
  const SERVICES = Number(process.env.SERVICES ?? 4);

  const tenant = await getTenantBySlug("skylark");
  if (!tenant) throw new Error("no skylark workspace");
  const source = await withTenant(tenant.id, async (tx) => {
    const [s] = await tx
      .select()
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, tenant.id), eq(alertSources.name, "Monitors")));
    return s;
  });
  if (!source) throw new Error("no managed source");

  const stamp = Date.now();
  const times: number[] = [];
  const started = Date.now();
  for (let n = 0; n < TOTAL; n++) {
    const t0 = Date.now();
    await ingestPayload(
      tenant.id,
      source,
      {
        title: `Bench ${stamp} ${n}`,
        status: "firing",
        severity: n % 5 === 0 ? "P1" : "P3",
        service: `bench-${n % SERVICES}`,
        environment: "production",
        dedup_key: `bench-${stamp}-${n}`,
      },
      { test: true },
    );
    times.push(Date.now() - t0);
  }
  const elapsed = Date.now() - started;
  times.sort((a, b) => a - b);
  const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!;
  console.log(
    JSON.stringify({
      alerts: TOTAL,
      elapsedMs: elapsed,
      perSecond: Math.round((TOTAL / elapsed) * 1000 * 10) / 10,
      p50: q(0.5),
      p90: q(0.9),
      p99: q(0.99),
      max: times[times.length - 1],
    }),
  );

  // Its own mess, cleaned up.
  const removed = await withTenant(tenant.id, (tx) =>
    tx
      .delete(alerts)
      .where(and(eq(alerts.tenantId, tenant.id), like(alerts.title, `Bench ${stamp}%`))),
  );
  console.log("cleaned", removed?.count ?? "rows");
  process.exit(0);
}

void main();
