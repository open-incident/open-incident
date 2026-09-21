/**
 * What is in the window, before anybody knows what to filter on.
 *
 * A filter language answers "show me the spans where X"; it cannot answer
 * "what is X, here, today". That is the gesture every SIEM is built around and
 * the one an APM's filter box is missing: land on a window, see that 61 % of
 * it is one service and 4 % of it returned 502, and click the 4 %.
 *
 * Exact counts, one pass. `sumMap([field], [1])` builds value → count for a
 * whole field in a single scan, so ten facets cost one read of the window
 * rather than ten — measured at 85 ms over a day of 1.4 million spans. Exact
 * rather than `topK`, because a share is the point and an approximate share
 * of an unknown total says nothing.
 *
 * Only low-cardinality columns are offered. Every field here is a
 * `LowCardinality(String)` or a small integer in the schema, which bounds the
 * map this builds; `trace_id` or `body` would build one row per value and is
 * exactly what this must not do. Attributes are asked for separately, by key,
 * for the same reason.
 */
import { compileFilter, type FilterKind } from "./filter";
import { chTime, read } from "./query";
import { EXCEPTIONS, LOGS, SPANS } from "./views";

export type FacetValue = { value: string; count: number; share: number };
export type Facet = { field: string; values: FacetValue[]; distinct: number };

/** Per signal, the fields worth counting, and how to read them as text. */
const FACETS: Record<Exclude<FilterKind, "metrics">, Array<{ field: string; sql: string }>> = {
  logs: [
    { field: "service_name", sql: "service_name" },
    { field: "severity_text", sql: "severity_text" },
    { field: "environment", sql: "environment" },
    { field: "scope_name", sql: "scope_name" },
  ],
  traces: [
    { field: "service_name", sql: "service_name" },
    { field: "status_code", sql: "toString(status_code)" },
    { field: "kind", sql: "toString(kind)" },
    { field: "http_route", sql: "http_route" },
    // Zero means "not an HTTP span", which is most of them and is not a
    // status; blanked here so the rail drops it like any other empty value.
    {
      field: "http_status_code",
      sql: "if(http_status_code = 0, '', toString(http_status_code))",
    },
    { field: "http_method", sql: "http_method" },
    { field: "peer_service", sql: "peer_service" },
    { field: "db_system", sql: "db_system" },
    { field: "environment", sql: "environment" },
  ],
  exceptions: [
    { field: "service_name", sql: "service_name" },
    { field: "type", sql: "type" },
    { field: "release", sql: "release" },
    { field: "environment", sql: "environment" },
  ],
};

const SOURCE: Record<Exclude<FilterKind, "metrics">, { from: string; ts: string }> = {
  logs: { from: LOGS, ts: "ts" },
  traces: { from: SPANS, ts: "start_ts" },
  exceptions: { from: EXCEPTIONS, ts: "ts" },
};

/** How many values a facet shows before it says how many more there are. */
const SHOWN = 6;

/**
 * The widest slice a rail will count.
 *
 * Exact counts over a window are one scan of it, which is 330 ms over a day of
 * logs and **4.6 s over a week of 22 million spans** — measured. A rail is read
 * while somebody waits for the list beside it, so past this the count is taken
 * over the most recent six hours of the window and the rail says so. Six hours
 * of shares is a true answer to "what is in here"; four and a half seconds is
 * not an answer at all.
 */
const MAX_SCAN_MINUTES = 360;

/** The slice actually counted, and whether it is the whole window. */
function scanWindow(opts: { from: Date; to: Date }): { from: Date; to: Date; whole: boolean } {
  const minutes = (opts.to.getTime() - opts.from.getTime()) / 60_000;
  if (minutes <= MAX_SCAN_MINUTES) return { from: opts.from, to: opts.to, whole: true };
  return {
    from: new Date(opts.to.getTime() - MAX_SCAN_MINUTES * 60_000),
    to: opts.to,
    whole: false,
  };
}

export async function facetsFor(
  kind: Exclude<FilterKind, "metrics">,
  tenantId: string,
  opts: { from: Date; to: Date; filter?: string; service?: string },
): Promise<{ total: number; facets: Facet[]; scanned: { from: Date; to: Date; whole: boolean } }> {
  const fields = FACETS[kind];
  const source = SOURCE[kind];
  const scan = scanWindow(opts);
  const where = [`${source.ts} >= {fromTs:DateTime64(9)}`, `${source.ts} <= {toTs:DateTime64(9)}`];
  const params: Record<string, unknown> = { fromTs: chTime(scan.from), toTs: chTime(scan.to) };
  if (opts.service) {
    where.push("service_name = {service:String}");
    params.service = opts.service;
  }
  if (opts.filter?.trim()) {
    const compiled = compileFilter(kind, opts.filter);
    where.push(compiled.sql);
    Object.assign(params, compiled.params);
  }

  const selects = fields.map((f, i) => `sumMap([${f.sql}], [toUInt64(1)]) AS f${i}`);
  const [row] = await read<Record<string, unknown>>(
    tenantId,
    `SELECT toString(count()) AS total, ${selects.join(", ")}
       FROM ${source.from}
      WHERE ${where.join(" AND ")}`,
    { params },
  );
  if (!row) return { total: 0, facets: [], scanned: scan };

  const total = Number(row.total ?? 0);
  const facets: Facet[] = [];
  for (const [i, f] of fields.entries()) {
    // `sumMap` comes back as [keys, counts] — two parallel arrays.
    const pair = row[`f${i}`] as [string[], Array<string | number>] | undefined;
    if (!pair) continue;
    const [keys, counts] = pair;
    const values = keys
      .map((value, k) => ({
        value,
        count: Number(counts[k] ?? 0),
        share: total > 0 ? Number(counts[k] ?? 0) / total : 0,
      }))
      // A blank is a real answer — "this span had no route" — but it is never
      // the one worth a line in a rail six values long.
      .filter((v) => v.value !== "" && v.count > 0)
      .sort((a, b) => b.count - a.count);
    if (values.length === 0) continue;
    facets.push({ field: f.field, values: values.slice(0, SHOWN), distinct: values.length });
  }
  return { total, facets, scanned: scan };
}

/**
 * Which attributes are in this window, and how often.
 *
 * Keys only. An attribute map holds whatever the instrumentation put there —
 * a user id, a request id, a cart total — and counting the *values* of a key
 * nobody chose is how a query reads a million distinct strings. So: the keys,
 * and then `facetValuesOf` for the one the reader picked.
 */
export async function attributeKeys(
  kind: Exclude<FilterKind, "metrics">,
  tenantId: string,
  opts: { from: Date; to: Date; filter?: string; service?: string; limit?: number },
): Promise<FacetValue[]> {
  const source = SOURCE[kind];
  const scan = scanWindow(opts);
  const where = [`${source.ts} >= {fromTs:DateTime64(9)}`, `${source.ts} <= {toTs:DateTime64(9)}`];
  const params: Record<string, unknown> = {
    fromTs: chTime(scan.from),
    toTs: chTime(scan.to),
    limit: opts.limit ?? 12,
  };
  if (opts.service) {
    where.push("service_name = {service:String}");
    params.service = opts.service;
  }
  if (opts.filter?.trim()) {
    const compiled = compileFilter(kind, opts.filter);
    where.push(compiled.sql);
    Object.assign(params, compiled.params);
  }
  const rows = await read<{ key: string; n: string; total: string }>(
    tenantId,
    `SELECT arrayJoin(mapKeys(attributes)) AS key,
            toString(count()) AS n,
            toString(sum(1) OVER ()) AS total
       FROM ${source.from}
      WHERE ${where.join(" AND ")}
      GROUP BY key
      ORDER BY count() DESC
      LIMIT {limit:UInt32}`,
    { params },
  );
  const total = Number(rows[0]?.total ?? 0) || 1;
  return rows.map((r) => ({ value: r.key, count: Number(r.n), share: Number(r.n) / total }));
}

/**
 * The values of one field, for the reader who clicked past the six shown.
 *
 * Also the only way to facet an attribute, whose key is not known in advance —
 * hence `attr:<name>`, compiled the same way a filter compiles it.
 */
export async function facetValuesOf(
  kind: Exclude<FilterKind, "metrics">,
  tenantId: string,
  field: string,
  opts: { from: Date; to: Date; filter?: string; service?: string; limit?: number },
): Promise<FacetValue[]> {
  const source = SOURCE[kind];
  const params: Record<string, unknown> = {
    fromTs: chTime(opts.from),
    toTs: chTime(opts.to),
    limit: opts.limit ?? 50,
  };
  const attr = /^attr:(.+)$/.exec(field.trim());
  let sql: string;
  if (attr) {
    params.facetKey = attr[1];
    sql = "attributes[{facetKey:String}]";
  } else {
    const known = FACETS[kind].find((f) => f.field === field);
    if (!known) throw new Error(`"${field}" is not a facet of ${kind}`);
    sql = known.sql;
  }
  const where = [`${source.ts} >= {fromTs:DateTime64(9)}`, `${source.ts} <= {toTs:DateTime64(9)}`];
  if (opts.service) {
    where.push("service_name = {service:String}");
    params.service = opts.service;
  }
  if (opts.filter?.trim()) {
    const compiled = compileFilter(kind, opts.filter);
    where.push(compiled.sql);
    Object.assign(params, compiled.params);
  }
  const rows = await read<{ value: string; n: string }>(
    tenantId,
    `SELECT ${sql} AS value, toString(count()) AS n
       FROM ${source.from}
      WHERE ${where.join(" AND ")}
      GROUP BY value
      ORDER BY count() DESC
      LIMIT {limit:UInt32}`,
    { params },
  );
  const total = rows.reduce((n, r) => n + Number(r.n), 0) || 1;
  return rows
    .filter((r) => r.value !== "")
    .map((r) => ({ value: r.value, count: Number(r.n), share: Number(r.n) / total }));
}
