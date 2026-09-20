/**
 * Metric points into ClickHouse, and the ceiling that keeps them affordable.
 *
 * The cardinality budget is the reason this file is not three lines. One
 * mislabelled counter — a user id in a label, a request id — turns a single
 * series into a million, and a column store answers that by getting slower for
 * everybody in the workspace until somebody reads a bill. So a workspace has a
 * ceiling on how many distinct series it keeps: past it, **new** series are
 * refused and counted while **existing** ones keep flowing.
 *
 * That order matters. Refusing the new and keeping the old leaves every
 * dashboard working while the mistake is found; the opposite — dropping
 * whatever arrives once the ceiling is hit — breaks the charts that were fine
 * and hides the one that is wrong.
 */
import { clickhouse } from "@openincident/telemetry";
import type { Caller } from "./auth";
import { resolveServices, type Outcome } from "./ingest";
import { retentionAt, scrubAttributes, type Settings } from "./shared";
import { hashAttributes, type MetricDecode, type MetricPoint } from "./metrics";

const DEFAULT_CARDINALITY_BUDGET = 50_000;

type Prepared = { point: MetricPoint; hash: string; service: string };

export async function ingestMetrics(
  caller: Caller,
  settings: Settings,
  decoded: MetricDecode,
): Promise<Outcome> {
  const out: Outcome = { accepted: 0, rejected: [] };

  for (const name of new Set(decoded.unsupported)) {
    out.rejected.push({
      reason: "exponential histograms and summaries are not stored yet",
      excerpt: name.slice(0, 200),
    });
  }

  const prepared: Prepared[] = [];
  for (const p of decoded.points) {
    const service = caller.pinnedServiceName ?? p.serviceName;
    if (!service) {
      out.rejected.push({ reason: "missing service.name", excerpt: p.metricName.slice(0, 200) });
      continue;
    }
    if (!p.metricName) {
      out.rejected.push({ reason: "metric without a name", excerpt: "" });
      continue;
    }
    // Scrubbed once, here: the hash must be computed on what is stored, or a
    // redacted label would produce a different series from the same source.
    const attributes = scrubAttributes(p.attributes, settings.scrubRules);
    prepared.push({ point: { ...p, attributes }, hash: hashAttributes(attributes), service });
  }
  if (prepared.length === 0) return out;

  const known = await knownSeries(caller.tenantId);
  const budget = settings.cardinalityBudget ?? DEFAULT_CARDINALITY_BUDGET;
  let room = Math.max(0, budget - known.size);
  const admitted = new Set(known);
  const refused = new Set<string>();

  for (const s of prepared) {
    if (admitted.has(s.hash)) continue;
    if (room > 0) {
      admitted.add(s.hash);
      room--;
    } else if (!refused.has(s.point.metricName)) {
      refused.add(s.point.metricName);
      out.rejected.push({
        reason: `cardinality budget of ${budget} series reached — new series dropped`,
        excerpt: s.point.metricName.slice(0, 200),
      });
    }
  }

  const keep = prepared.filter((s) => admitted.has(s.hash));
  if (keep.length === 0) return out;

  const ch = clickhouse();
  const until = retentionAt(settings.retentionMetricsDays);
  const ids = await resolveServices(
    caller,
    keep.map((s) => ({ name: s.service, ra: {} })),
  );

  // The catalogue first. A point whose series is unknown would still be
  // readable, but the label pickers and the budget both read this table, and a
  // series that exists only in the points is a series nobody can find.
  const series = new Map<string, Prepared>();
  for (const s of keep) series.set(`${s.point.metricName} ${s.hash}`, s);
  await ch.insert({
    table: "metric_series",
    format: "JSONEachRow",
    values: [...series.values()].map((s) => ({
      tenant_id: caller.tenantId,
      metric_name: s.point.metricName,
      attributes_hash: s.hash,
      type: s.point.kind,
      unit: s.point.unit,
      service_name: s.service,
      attributes: s.point.attributes,
      first_seen: s.point.ts.slice(0, 19),
      last_seen: s.point.ts.slice(0, 19),
    })),
  });

  const common = (s: Prepared) => ({
    tenant_id: caller.tenantId,
    service_id: ids.get(s.service)!,
    service_name: s.service,
    environment: s.point.environment,
    metric_name: s.point.metricName,
    description: s.point.description,
    unit: s.point.unit,
    ts: s.point.ts,
    attributes: s.point.attributes,
    attributes_hash: s.hash,
    exemplars: [],
    retention_at: until,
  });

  const gauges = keep.filter((s) => s.point.kind === "gauge");
  const sums = keep.filter((s) => s.point.kind === "sum");
  const hists = keep.filter((s) => s.point.kind === "histogram");

  if (gauges.length) {
    await ch.insert({
      table: "otel_metrics_gauge",
      format: "JSONEachRow",
      values: gauges.map((s) => ({ ...common(s), value: s.point.value ?? 0 })),
    });
  }
  if (sums.length) {
    await ch.insert({
      table: "otel_metrics_sum",
      format: "JSONEachRow",
      values: sums.map((s) => ({
        ...common(s),
        value: s.point.value ?? 0,
        is_monotonic: s.point.isMonotonic ?? false,
        aggregation_temporality: s.point.temporality ?? "unspecified",
      })),
    });
  }
  if (hists.length) {
    await ch.insert({
      table: "otel_metrics_histogram",
      format: "JSONEachRow",
      values: hists.map((s) => ({
        ...common(s),
        count: s.point.count ?? 0,
        sum: s.point.sum ?? 0,
        min: s.point.min ?? 0,
        max: s.point.max ?? 0,
        bucket_counts: s.point.bucketCounts ?? [],
        explicit_bounds: s.point.explicitBounds ?? [],
        aggregation_temporality: s.point.temporality ?? "unspecified",
      })),
    });
  }

  out.accepted = keep.length;
  return out;
}

/**
 * Every series this workspace already keeps.
 *
 * Read whole rather than looked up per batch, because the budget asks "how
 * many series does this workspace have", not "how many are in this request".
 * At the default ceiling that is fifty thousand short strings — cheap next to
 * the points it protects.
 */
async function knownSeries(tenantId: string): Promise<Set<string>> {
  const rs = await clickhouse().query({
    query: `SELECT DISTINCT toString(attributes_hash) AS h
              FROM metric_series
             WHERE tenant_id = {tenant:UUID}`,
    query_params: { tenant: tenantId },
    format: "JSONEachRow",
  });
  return new Set((await rs.json<{ h: string }>()).map((r) => r.h));
}
