/**
 * Demo rows the V2 design shows for shell-home — idempotent: running it twice
 * leaves the same rows. Called by the demo seed and by `run.ts --part shell-home`.
 * Owner: shell-home.
 *
 * Home's Certificates card reads the certificate monitors and what their last
 * check found. The demo has one (api.skylark.dev, valid for two months); this
 * adds the four the design draws around it — one expiring inside a week, one
 * inside a month, two comfortably valid — each with a last check that recorded
 * the certificate it was shown (issuer and expiry), exactly as the worker's
 * certificate check writes it.
 *
 * Like every demo monitor they are paused — since three days, as the others —
 * because the hosts are the demo's and are not to be reached from a
 * developer's machine. The expiry dates are re-anchored on "now" at every run,
 * so the card keeps saying 6 and 19 days.
 */
import { and, eq, sql } from "drizzle-orm";
import { members, monitorChecks, monitors, services } from "../../schema/app";
import type { SeedTx } from "./types";

const DAY = 86_400_000;
const HOUR = 3_600_000;

type Cert = {
  name: string;
  host: string;
  issuer: string;
  days: number;
  service: string | null;
  latency: number;
  /** Only the new monitors are created; an existing one only gets its last check. */
  existing?: boolean;
};

const CERTS: Cert[] = [
  {
    name: "auth.skylark.dev certificate",
    host: "auth.skylark.dev",
    issuer: "Let's Encrypt",
    days: 6,
    service: "auth-service",
    latency: 38,
  },
  {
    name: "status.skylark.dev certificate",
    host: "status.skylark.dev",
    issuer: "Let's Encrypt",
    days: 19,
    service: null,
    latency: 44,
  },
  {
    name: "www.skylark.dev certificate",
    host: "www.skylark.dev",
    issuer: "DigiCert",
    days: 143,
    service: "web-storefront",
    latency: 52,
  },
  {
    name: "checkout.skylark.dev certificate",
    host: "checkout.skylark.dev",
    issuer: "Let's Encrypt",
    days: 61,
    service: "checkout-api",
    latency: 47,
  },
  {
    name: "api.skylark.dev certificate",
    host: "api.skylark.dev",
    issuer: "Let's Encrypt",
    days: 68,
    service: "checkout-api",
    latency: 41,
    existing: true,
  },
];

/** The thresholds a certificate monitor starts with. */
const EXPIRY = [
  { on: "reachable", op: "eq", value: "false", then: "offline" },
  { on: "days_to_expiry", op: "lt", value: "7", then: "offline" },
  { on: "days_to_expiry", op: "lt", value: "30", then: "degraded" },
  { on: "reachable", op: "eq", value: "true", then: "online" },
] as const;

export async function seed(tx: SeedTx, tenantId: string): Promise<void> {
  const now = new Date();
  // The last check is the one before the pause, three days back, as for every
  // other demo monitor.
  const checkedAt = new Date(now.getTime() - 3 * DAY);

  const svcRows: Array<{ id: string; key: string }> = await tx
    .select({ id: services.id, key: services.key })
    .from(services)
    .where(eq(services.tenantId, tenantId));
  const serviceId = new Map(svcRows.map((s) => [s.key, s.id]));
  const [owner]: Array<{ id: string }> = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.tenantId, tenantId), eq(members.email, "amelie@skylark.dev")))
    .limit(1);

  for (const c of CERTS) {
    const validTo = new Date(now.getTime() + c.days * DAY + 12 * HOUR);
    const detail = `expires in ${c.days + 3} days`;
    const [found]: Array<{ id: string }> = await tx
      .select({ id: monitors.id })
      .from(monitors)
      .where(and(eq(monitors.tenantId, tenantId), eq(monitors.name, c.name)))
      .limit(1);
    let monitorId = found?.id;
    if (!monitorId) {
      if (c.existing) continue;
      const [row]: Array<{ id: string }> = await tx
        .insert(monitors)
        .values({
          tenantId,
          name: c.name,
          type: "ssl",
          target: c.host,
          intervalSeconds: 3_600,
          criteria: EXPIRY.map((x) => ({ ...x })),
          action: { page: { kind: "owner" }, incident: { from: "urgent" }, autoResolve: true },
          serviceId: c.service ? (serviceId.get(c.service) ?? null) : null,
          state: "paused",
          stateSince: checkedAt,
          lastCheckAt: checkedAt,
          lastLatencyMs: c.latency,
          lastDetail: detail,
          paused: true,
          createdByMemberId: owner?.id ?? null,
        })
        .returning({ id: monitors.id });
      monitorId = row!.id;
    } else if (!c.existing) {
      await tx
        .update(monitors)
        .set({ lastCheckAt: checkedAt, lastDetail: detail, lastLatencyMs: c.latency })
        .where(eq(monitors.id, monitorId));
    }

    // One check that recorded the certificate — replaced, never piled up.
    await tx
      .delete(monitorChecks)
      .where(
        and(
          eq(monitorChecks.tenantId, tenantId),
          eq(monitorChecks.monitorId, monitorId),
          sql`${monitorChecks.result}->>'kind' = 'ssl'`,
        ),
      );
    await tx.insert(monitorChecks).values({
      tenantId,
      monitorId,
      at: checkedAt,
      state: c.days < 7 ? "offline" : c.days < 30 ? "degraded" : "online",
      latencyMs: c.latency,
      detail,
      result: {
        kind: "ssl",
        tls: { validTo: validTo.toISOString(), issuer: c.issuer },
      },
    });
  }
}
