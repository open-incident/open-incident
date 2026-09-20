/**
 * What the telemetry screens read, and what they may write.
 *
 * The queries themselves live in `@openincident/telemetry`, behind the tenant
 * guard; this module is the app's side of the wall — it adds the workspace's
 * own configuration from PostgreSQL, and the one write the screens perform:
 * issuing and revoking an ingestion key.
 *
 * Nothing here decides whether the module exists. `telemetryInstalled()` does,
 * in one place, and every caller asks before it reads.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  forgetTelemetryKey,
  registerTelemetryKey,
  telemetryIngestionKeys,
  telemetryRejections,
  telemetryUsage,
  withTenant,
} from "@openincident/db";
import {
  exceptionDetail as detailOf,
  exceptionGroups as groupsOf,
  metricNames,
  metricSeries,
  recentLogs,
  recentTraces,
  seriesLabels,
  spansOfTrace,
  telemetryInstalled,
  type LogRow,
  type SpanRow,
  type TraceRow,
} from "@openincident/telemetry";

export { telemetryInstalled };
export type { LogRow, SpanRow, TraceRow };

export type IngestionKey = {
  id: string;
  label: string;
  signals: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export async function listKeys(tenantId: string): Promise<IngestionKey[]> {
  return withTenant(tenantId, async (tx) =>
    tx
      .select({
        id: telemetryIngestionKeys.id,
        label: telemetryIngestionKeys.label,
        signals: telemetryIngestionKeys.signals,
        createdAt: telemetryIngestionKeys.createdAt,
        lastUsedAt: telemetryIngestionKeys.lastUsedAt,
        revokedAt: telemetryIngestionKeys.revokedAt,
      })
      .from(telemetryIngestionKeys)
      .where(eq(telemetryIngestionKeys.tenantId, tenantId))
      .orderBy(desc(telemetryIngestionKeys.createdAt)),
  );
}

/**
 * Issues a key and returns it once.
 *
 * Only the digest is stored, so this string cannot be shown again — which the
 * screen says before it is generated, not after. The lookup row in `directory`
 * is written in the same breath: a key the ingestion path cannot resolve is a
 * key that silently rejects everything.
 */
export async function issueKey(tenantId: string, label: string): Promise<string> {
  const key = `oi_otel_${randomBytes(16).toString("hex")}`;
  const keyHash = createHash("sha256").update(key).digest("hex");
  const signals = ["logs", "traces", "metrics"];
  const keyId = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .insert(telemetryIngestionKeys)
      .values({ tenantId, keyHash, label: label.slice(0, 80) || "collector", signals })
      .returning({ id: telemetryIngestionKeys.id });
    return row!.id;
  });
  await registerTelemetryKey({ keyHash, tenantId, keyId, signals, pinnedServiceName: null });
  return key;
}

export async function revokeKey(tenantId: string, id: string): Promise<void> {
  const hash = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .update(telemetryIngestionKeys)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(telemetryIngestionKeys.tenantId, tenantId), eq(telemetryIngestionKeys.id, id)))
      .returning({ keyHash: telemetryIngestionKeys.keyHash });
    return row?.keyHash ?? null;
  });
  // The lookup row goes too, rather than being marked: revocation must take
  // effect on the next request, not on the next cache expiry.
  if (hash) await forgetTelemetryKey(hash);
}

export type Rejection = { reason: string; excerpt: string; signal: string; createdAt: Date };

export async function recentRejections(tenantId: string, limit = 8): Promise<Rejection[]> {
  return withTenant(tenantId, async (tx) =>
    tx
      .select({
        reason: telemetryRejections.reason,
        excerpt: telemetryRejections.excerpt,
        signal: telemetryRejections.signal,
        createdAt: telemetryRejections.createdAt,
      })
      .from(telemetryRejections)
      .where(eq(telemetryRejections.tenantId, tenantId))
      .orderBy(desc(telemetryRejections.createdAt))
      .limit(limit),
  );
}

export async function usageToday(
  tenantId: string,
): Promise<Array<{ signal: string; rows: number }>> {
  const day = new Date().toISOString().slice(0, 10);
  return withTenant(tenantId, async (tx) =>
    tx
      .select({ signal: telemetryUsage.signal, rows: telemetryUsage.rows })
      .from(telemetryUsage)
      .where(and(eq(telemetryUsage.tenantId, tenantId), eq(telemetryUsage.day, day))),
  );
}

/** The Logs screen. Empty when nothing has arrived — which is a fact, not an error. */
export async function logs(
  tenantId: string,
  opts: { traceId?: string; service?: string; limit?: number } = {},
): Promise<LogRow[]> {
  if (!telemetryInstalled()) return [];
  return recentLogs(tenantId, opts);
}

export async function traces(tenantId: string, limit = 60): Promise<TraceRow[]> {
  if (!telemetryInstalled()) return [];
  return recentTraces(tenantId, { limit });
}

export async function trace(tenantId: string, traceId: string): Promise<SpanRow[]> {
  if (!telemetryInstalled()) return [];
  return spansOfTrace(tenantId, traceId);
}

export type { MetricName } from "@openincident/telemetry";

/** The metric catalogue: one line per name, with how many series it carries. */
export async function metricCatalogue(tenantId: string) {
  if (!telemetryInstalled()) return [];
  return metricNames(tenantId);
}

/**
 * One metric, its series and their per-minute values.
 *
 * The labels come from the catalogue rather than from the points: a series
 * that stopped reporting an hour ago still has a name, and a chart that drops
 * it silently is a chart that hides an outage.
 */
export async function metricChart(tenantId: string, metricName: string) {
  if (!telemetryInstalled()) return { series: [] };
  const [rows, labels] = await Promise.all([
    metricSeries(tenantId, metricName, { hours: 24 }),
    seriesLabels(tenantId, metricName),
  ]);
  const byHash = new Map<string, number[]>();
  for (const r of rows) {
    const list = byHash.get(r.attributes_hash) ?? [];
    list.push(Number(r.value));
    byHash.set(r.attributes_hash, list);
  }
  return {
    series: labels.map((l) => ({
      hash: l.attributes_hash,
      labels: l.attributes,
      values: byHash.get(l.attributes_hash) ?? [],
    })),
  };
}

export type { ExceptionGroup, ExceptionOccurrence } from "@openincident/telemetry";

/** The exception groups a workspace carries, newest activity first. */
export async function exceptionGroups(tenantId: string) {
  if (!telemetryInstalled()) return [];
  return groupsOf(tenantId);
}

export async function exceptionDetail(tenantId: string, fingerprint: string) {
  if (!telemetryInstalled()) return null;
  return detailOf(tenantId, fingerprint);
}
