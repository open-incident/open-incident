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
import { and, desc, eq, gte } from "drizzle-orm";
import {
  forgetTelemetryKey,
  registerTelemetryKey,
  telemetryIngestionKeys,
  changeEvents,
  telemetryRejections,
  telemetrySettings,
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

export type UsageToday = {
  rows: number;
  /** Rows sampled out for being over the soft cap. Valid data, not stored. */
  dropped: number;
  capGb: number | null;
};

/**
 * The day so far, and whether it is being thinned.
 *
 * `dropped` is what actually happened rather than the rate the endpoint is
 * applying. The two answer different questions and the measured one is the
 * better answer: recomputing the formula here would be a second place for it
 * to live, and a prediction shown beside real rows invites the reader to
 * believe the prediction.
 */
export async function usageToday(tenantId: string): Promise<UsageToday> {
  const day = new Date().toISOString().slice(0, 10);
  return withTenant(tenantId, async (tx) => {
    const [used, settings] = await Promise.all([
      tx
        .select({ rows: telemetryUsage.rows, dropped: telemetryUsage.dropped })
        .from(telemetryUsage)
        .where(and(eq(telemetryUsage.tenantId, tenantId), eq(telemetryUsage.day, day))),
      tx
        .select({ capGb: telemetrySettings.dailySoftCapGb })
        .from(telemetrySettings)
        .where(eq(telemetrySettings.tenantId, tenantId)),
    ]);
    return {
      rows: used.reduce((n, r) => n + r.rows, 0),
      dropped: used.reduce((n, r) => n + r.dropped, 0),
      capGb: settings[0]?.capGb ?? null,
    };
  });
}

/** The Logs screen. Empty when nothing has arrived — which is a fact, not an error. */
export async function logs(
  tenantId: string,
  opts: { traceId?: string; service?: string; limit?: number; filter?: string } = {},
): Promise<LogRow[]> {
  if (!telemetryInstalled()) return [];
  return recentLogs(tenantId, opts);
}

export async function traces(
  tenantId: string,
  opts: { limit?: number; service?: string; filter?: string } = {},
): Promise<TraceRow[]> {
  if (!telemetryInstalled()) return [];
  return recentTraces(tenantId, { limit: opts.limit ?? 60, ...opts });
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
export type MetricPoint = { at: number; value: number };

/**
 * One metric's series over a window, and the changes that landed inside it.
 *
 * The points keep their timestamps. They used to be flattened to bare numbers,
 * which is enough to draw a shape and not enough to say *when* — and "when"
 * is the whole question once a deploy marker is drawn on the same axis.
 *
 * The changes come from the same window rather than from a fixed count: "what
 * changed while this was happening" is the first question of every incident,
 * and a chart that answers it costs one small query against a table the
 * product already fills.
 */
export async function metricChart(tenantId: string, metricName: string, hours = 24) {
  if (!telemetryInstalled()) return { series: [], changes: [], from: 0, to: 0 };
  const to = Date.now();
  const from = to - hours * 3_600_000;
  const [rows, labels, changes] = await Promise.all([
    metricSeries(tenantId, metricName, { hours }),
    seriesLabels(tenantId, metricName),
    changesSince(tenantId, new Date(from)),
  ]);
  const byHash = new Map<string, MetricPoint[]>();
  for (const r of rows) {
    const list = byHash.get(r.attributes_hash) ?? [];
    // ClickHouse hands back "2026-09-20 21:04:00" — no zone, and it is UTC.
    // Parsed without the `Z` a browser reads it as local time and every point
    // lands an hour or two off the deploy marker beside it.
    list.push({ at: Date.parse(`${r.minute.replace(" ", "T")}Z`), value: Number(r.value) });
    byHash.set(r.attributes_hash, list);
  }
  return {
    from,
    to,
    changes,
    series: labels.map((l) => ({
      hash: l.attributes_hash,
      labels: l.attributes,
      points: byHash.get(l.attributes_hash) ?? [],
    })),
  };
}

export type ChangeMark = { id: string; kind: string; title: string; at: number };

/** Deploys, flags and config changes since an instant — what a chart annotates. */
export async function changesSince(tenantId: string, since: Date): Promise<ChangeMark[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: changeEvents.id,
        kind: changeEvents.kind,
        title: changeEvents.title,
        occurredAt: changeEvents.occurredAt,
      })
      .from(changeEvents)
      .where(and(eq(changeEvents.tenantId, tenantId), gte(changeEvents.occurredAt, since)))
      .orderBy(desc(changeEvents.occurredAt))
      .limit(20),
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    at: r.occurredAt.getTime(),
  }));
}

export type { ExceptionGroup, ExceptionOccurrence } from "@openincident/telemetry";

/** The exception groups a workspace carries, newest activity first. */
export async function exceptionGroups(
  tenantId: string,
  opts: { limit?: number; service?: string; filter?: string } = {},
) {
  if (!telemetryInstalled()) return [];
  return groupsOf(tenantId, opts);
}

export async function exceptionDetail(tenantId: string, fingerprint: string) {
  if (!telemetryInstalled()) return null;
  return detailOf(tenantId, fingerprint);
}

export {
  layoutByDepth,
  neighbours,
  logPatterns,
  serviceWindow,
  flamegraph,
  profileDiff,
  profileFunctions,
  profileKinds,
  rumErrors,
  rumRoutes,
  rumReplayed,
  rumSegments,
  rumSession,
  rumSessions,
  rumVitals,
  SQL_MAX_ROWS,
  SQL_TABLES,
  SqlError,
  runUserSql,
  serviceEdges,
  servicesSeen,
  type EdgeRow,
  type Neighbour,
} from "@openincident/telemetry";
