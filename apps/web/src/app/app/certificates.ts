/**
 * The certificates Home watches — read from the certificate monitors and
 * what their last check found.
 *
 * A check records the certificate it was shown (issuer and expiry) in its
 * `result.tls` — the certificate check, and an HTTPS check off the same
 * handshake; the days left are counted from that expiry now, so a monitor
 * checked once a day still says the right thing at night. A check written
 * before the certificate was recorded only left a sentence ("expires in 68
 * days") — that is read too, counted from when it was written, and the issuer
 * is then unknown rather than guessed.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { monitorChecks, monitors, type Tx } from "@openincident/db";

export type CertLevel = 0 | 1 | 2;

export type CertRow = {
  monitorId: string;
  name: string;
  host: string;
  issuer: string | null;
  validTo: Date;
  daysLeft: number;
  /** 0 valid for more than 30 days, 1 inside 30, 2 inside 7 (or expired). */
  level: CertLevel;
};

const DAY = 86_400_000;

/** The thresholds a certificate monitor starts with — offline under 7 days, degraded under 30. */
export function certLevel(daysLeft: number): CertLevel {
  return daysLeft < 7 ? 2 : daysLeft < 30 ? 1 : 0;
}

function hostOf(target: string): string {
  const raw = target.trim().replace(/^[a-z]+:\/\//i, "");
  return raw.split("/")[0]!.replace(/:443$/, "") || target;
}

export async function listCertificates(
  tx: Tx,
  tenantId: string,
  now = new Date(),
): Promise<CertRow[]> {
  const rows = await tx
    .select({
      id: monitors.id,
      name: monitors.name,
      target: monitors.target,
      lastDetail: monitors.lastDetail,
      lastCheckAt: monitors.lastCheckAt,
    })
    .from(monitors)
    .where(and(eq(monitors.tenantId, tenantId), eq(monitors.type, "ssl")));
  if (rows.length === 0) return [];

  // The latest check of each monitor that recorded a certificate.
  const recorded = await tx
    .selectDistinctOn([monitorChecks.monitorId], {
      monitorId: monitorChecks.monitorId,
      at: monitorChecks.at,
      result: monitorChecks.result,
    })
    .from(monitorChecks)
    .where(
      and(
        eq(monitorChecks.tenantId, tenantId),
        inArray(
          monitorChecks.monitorId,
          rows.map((r) => r.id),
        ),
        sql`${monitorChecks.result} ? 'tls'`,
      ),
    )
    .orderBy(monitorChecks.monitorId, desc(monitorChecks.at));
  const byMonitor = new Map(recorded.map((r) => [r.monitorId, r]));

  const out: CertRow[] = [];
  for (const m of rows) {
    const cert = byMonitor.get(m.id)?.result?.tls as
      { validTo?: string; issuer?: string | null } | undefined;
    let validTo: Date | null = null;
    let issuer: string | null = null;
    if (cert?.validTo && !Number.isNaN(Date.parse(cert.validTo))) {
      validTo = new Date(cert.validTo);
      issuer = cert.issuer?.trim() || null;
    } else if (m.lastDetail && m.lastCheckAt) {
      const days = /expires in (-?\d+) days?/i.exec(m.lastDetail)?.[1];
      if (days !== undefined) validTo = new Date(m.lastCheckAt.getTime() + Number(days) * DAY);
    }
    // Never checked, or the last check could not read a certificate: nothing
    // is known about its expiry, and the card says nothing rather than guess.
    if (!validTo) continue;
    const daysLeft = Math.floor((validTo.getTime() - now.getTime()) / DAY);
    out.push({
      monitorId: m.id,
      name: m.name,
      host: hostOf(m.target),
      issuer,
      validTo,
      daysLeft,
      level: certLevel(daysLeft),
    });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}
