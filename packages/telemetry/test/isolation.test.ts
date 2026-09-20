/**
 * Tenant isolation in ClickHouse — the mechanism, not a sample.
 *
 * Two workspaces write logs and spans into the same tables, as the product
 * does. The test then tries what a bug would try: read the other workspace's
 * rows through the query layer, and reach the raw tables to escape the filter
 * entirely. Neither may work — and the second must fail loudly rather than
 * return everything, because a query that forgets its tenant is the one thing
 * a shared column store cannot forgive.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clickhouse, closeClickhouse } from "../src/client";
import { migrateClickhouse } from "../src/migrate";
import { LOGS, read, recentLogs, recentTraces, spansOfTrace } from "../src/query";

const A = randomUUID();
const B = randomUUID();
const traceA = randomUUID().replace(/-/g, "");
const traceB = randomUUID().replace(/-/g, "");

/** Far enough ahead that a TTL merge cannot remove the fixtures mid-test. */
const retention = "2099-01-01 00:00:00";

function span(tenant: string, traceId: string, service: string, spanId: string, parent = "") {
  const now = new Date();
  return {
    tenant_id: tenant,
    service_id: randomUUID(),
    service_name: service,
    environment: "test",
    service_version: "1.0.0",
    start_ts: now.toISOString().replace("T", " ").replace("Z", ""),
    end_ts: new Date(now.getTime() + 12).toISOString().replace("T", " ").replace("Z", ""),
    duration_ns: 12_000_000,
    trace_id: traceId,
    span_id: spanId,
    parent_span_id: parent,
    name: parent ? "SELECT orders" : "GET /checkout",
    kind: parent ? "client" : "server",
    status_code: "ok",
    status_message: "",
    http_method: parent ? "" : "GET",
    http_route: parent ? "" : "/checkout",
    http_status_code: parent ? 0 : 200,
    db_system: parent ? "postgresql" : "",
    rpc_service: "",
    peer_service: "",
    attributes: {},
    resource_attributes: {},
    events: [],
    links: [],
    has_exception: false,
    sampled_ratio: 1,
    retention_at: retention,
  };
}

function log(tenant: string, traceId: string, service: string, body: string) {
  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  return {
    tenant_id: tenant,
    service_id: randomUUID(),
    service_name: service,
    environment: "test",
    ts: now,
    observed_ts: now,
    severity_number: 9,
    severity_text: "INFO",
    body,
    trace_id: traceId,
    span_id: "",
    scope_name: "test",
    attributes: {},
    resource_attributes: {},
    retention_at: retention,
  };
}

beforeAll(async () => {
  await migrateClickhouse();
  const ch = clickhouse();
  await ch.insert({
    table: "otel_spans",
    format: "JSONEachRow",
    values: [
      span(A, traceA, "checkout-api", "aaaa000000000001"),
      span(A, traceA, "orders-db", "aaaa000000000002", "aaaa000000000001"),
      span(B, traceB, "billing-api", "bbbb000000000001"),
    ],
  });
  await ch.insert({
    table: "otel_logs",
    format: "JSONEachRow",
    values: [
      log(A, traceA, "checkout-api", "checkout completed for order 42"),
      log(B, traceB, "billing-api", "invoice issued"),
    ],
  });
  // The materialized view feeds an AggregatingMergeTree; the read path merges
  // states, so no flush is needed — but the insert must be visible first.
  await ch.command({ query: "SYSTEM FLUSH ASYNC INSERT QUEUE" });
});

afterAll(async () => {
  const ch = clickhouse();
  for (const t of ["otel_logs", "otel_spans", "otel_traces_index"]) {
    await ch.command({
      query: `DELETE FROM ${t} WHERE tenant_id IN ({a:UUID}, {b:UUID})`,
      query_params: { a: A, b: B },
    });
  }
  await closeClickhouse();
});

describe("a workspace reads its telemetry and only its telemetry", () => {
  it("sees its own logs, and not the other workspace's", async () => {
    const mine = await recentLogs(A);
    expect(mine.map((l) => l.body)).toContain("checkout completed for order 42");
    expect(mine.map((l) => l.body)).not.toContain("invoice issued");

    const theirs = await recentLogs(B);
    expect(theirs.map((l) => l.body)).toEqual(["invoice issued"]);
  });

  it("summarises its own trace, with both spans and both services", async () => {
    const traces = await recentTraces(A);
    const t = traces.find((x) => x.trace_id === traceA);
    expect(t).toBeDefined();
    expect(Number(t!.span_count)).toBe(2);
    expect(t!.root_name).toBe("GET /checkout");
    expect([...t!.services].sort()).toEqual(["checkout-api", "orders-db"]);
    expect(traces.map((x) => x.trace_id)).not.toContain(traceB);
  });

  it("cannot open the other workspace's trace by knowing its id", async () => {
    expect(await spansOfTrace(A, traceB)).toEqual([]);
    expect((await spansOfTrace(A, traceA)).length).toBe(2);
  });

  it("refuses a query that names a raw table instead of the tenant view", async () => {
    await expect(read(A, "SELECT count() FROM otel_logs")).rejects.toThrow(/raw table/);
    await expect(read(A, "SELECT count() FROM otel_spans WHERE 1")).rejects.toThrow(/raw table/);
    // The parameterized view is the sanctioned spelling and must still pass.
    await expect(read(A, `SELECT count() AS c FROM ${LOGS}`)).resolves.toBeDefined();
  });

  it("refuses a caller that tries to bind the tenant itself", async () => {
    await expect(read(A, `SELECT count() FROM ${LOGS}`, { params: { tenant: B } })).rejects.toThrow(
      /bound by the query layer/,
    );
  });
});
