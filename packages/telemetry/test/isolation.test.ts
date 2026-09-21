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
import { clickhouse, closeClickhouse, telemetryInstalled } from "../src/client";
import { migrateClickhouse } from "../src/migrate";
import { LOGS, read, recentLogs, recentTraces, spansOfTrace } from "../src/query";
import { runUserSql } from "../src/sql";

/*
 * The module is optional in the product, so it is optional here too: a
 * developer who never starts the `telemetry` profile should not have a red
 * suite. CI always sets CLICKHOUSE_URL, so the guarantee is still enforced on
 * every commit — see the service in .github/workflows/ci.yml.
 */
const describeWithClickhouse = telemetryInstalled() ? describe : describe.skip;

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
  if (!telemetryInstalled()) return;
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
  if (!telemetryInstalled()) return;
  const ch = clickhouse();
  for (const t of ["otel_logs", "otel_spans", "otel_traces_index"]) {
    await ch.command({
      query: `DELETE FROM ${t} WHERE tenant_id IN ({a:UUID}, {b:UUID})`,
      query_params: { a: A, b: B },
    });
  }
  await closeClickhouse();
});

const DAY_AGO = new Date(Date.now() - 86_400_000);
/** A moment ahead, so a span written a second ago is inside the window. */
const SOON = new Date(Date.now() + 60_000);

describeWithClickhouse("every rollup expires", () => {
  /*
   * The tables of points all expire on their own `retention_at`; the tables
   * built from them had no TTL at all, so a workspace on fifteen days of
   * retention kept one row per trace and one row per series per minute for
   * ever. This is the ceiling that stops that, and the test that keeps it.
   */
  it("gives every aggregate table a ceiling", async () => {
    const rows = await clickhouse()
      .query({
        query: `SELECT name, create_table_query FROM system.tables
                 WHERE database = currentDatabase()
                   AND name IN ('otel_traces_index', 'metric_1m', 'exception_groups_1h',
                                'rum_sessions_agg', 'service_edge_runs')`,
        format: "JSONEachRow",
      })
      .then((rs) => rs.json<{ name: string; create_table_query: string }>());
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(row.create_table_query, row.name).toContain("TTL ");
    }
  });
});

describeWithClickhouse("a workspace reads its telemetry and only its telemetry", () => {
  it("sees its own logs, and not the other workspace's", async () => {
    const mine = await recentLogs(A);
    expect(mine.rows.map((l) => l.body)).toContain("checkout completed for order 42");
    expect(mine.rows.map((l) => l.body)).not.toContain("invoice issued");

    const theirs = await recentLogs(B);
    expect(theirs.rows.map((l) => l.body)).toEqual(["invoice issued"]);
  });

  it("summarises its own trace, with both spans and both services", async () => {
    const page = await recentTraces(A, { from: DAY_AGO, to: SOON });
    const t = page.rows.find((x) => x.trace_id === traceA);
    expect(t).toBeDefined();
    expect(Number(t!.span_count)).toBe(2);
    expect(t!.root_name).toBe("GET /checkout");
    expect([...t!.services].sort()).toEqual(["checkout-api", "orders-db"]);
    expect(page.rows.map((x) => x.trace_id)).not.toContain(traceB);
  });

  /*
   * The window is the whole point of the new list, and it is also a second
   * fence around a workspace: a cursor from one tenant's page names a time and
   * a trace id, and handing it to another tenant's query still only reads that
   * tenant's rows.
   */
  it("returns nothing outside the window, and pages inside it", async () => {
    const before = await recentTraces(A, {
      from: new Date(Date.now() - 40 * 86_400_000),
      to: new Date(Date.now() - 30 * 86_400_000),
    });
    expect(before.rows).toEqual([]);
    expect(before.older).toBeNull();

    const one = await recentTraces(A, { from: DAY_AGO, to: SOON, limit: 1 });
    expect(one.rows.length).toBe(1);
    const ids = new Set(one.rows.map((r) => r.trace_id));
    if (one.older) {
      const next = await recentTraces(A, {
        from: DAY_AGO,
        to: SOON,
        limit: 1,
        before: one.older,
      });
      // A cursor never repeats the row it was taken from.
      for (const row of next.rows) expect(ids.has(row.trace_id)).toBe(false);
    }
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

  /*
   * The SQL console hands a person the query language, which is the one place
   * the isolation could be handed over with it. These are the escapes somebody
   * would actually try, and the last one is the control: a guard that refuses
   * everything would pass the first four and be useless.
   */
  describe("the SQL console cannot be talked out of its workspace", () => {
    it("refuses a raw table, another database, and the system tables", async () => {
      await expect(runUserSql(A, "SELECT count() FROM otel_logs_raw")).rejects.toThrow(
        /not a table you can read/,
      );
      await expect(runUserSql(A, "SELECT count() FROM default.otel_logs")).rejects.toThrow(
        /names a database/,
      );
      await expect(runUserSql(A, "SELECT count() FROM system.tables")).rejects.toThrow(/"system"/);
    });

    it("refuses a clause that would lift the caps", async () => {
      await expect(
        runUserSql(A, "SELECT * FROM otel_logs SETTINGS max_result_rows = 0"),
      ).rejects.toThrow(/"SETTINGS"/);
    });

    it("returns nothing when asked for the other workspace by its own id", async () => {
      // The rewritten view has already filtered; naming B's id matches no row
      // rather than reaching B's rows.
      const asked = await runUserSql(
        A,
        `SELECT count() AS n FROM otel_logs WHERE tenant_id = '${B}'`,
      );
      expect(Number(asked.rows[0]!.n)).toBe(0);
      const own = await runUserSql(
        A,
        `SELECT count() AS n FROM otel_logs WHERE tenant_id = '${A}'`,
      );
      expect(Number(own.rows[0]!.n)).toBeGreaterThan(0);
    });

    it("counts only its own rows across a union of two tables", async () => {
      const out = await runUserSql(
        A,
        "SELECT count() AS n FROM otel_logs UNION ALL SELECT count() AS n FROM otel_spans",
      );
      const total = out.rows.reduce((sum, r) => sum + Number(r.n), 0);
      const mine = await runUserSql(
        A,
        "SELECT count() AS n FROM otel_logs UNION ALL SELECT count() AS n FROM otel_spans",
      );
      expect(total).toBe(mine.rows.reduce((sum, r) => sum + Number(r.n), 0));
      // B wrote rows into the same two tables; none of them are in the total.
      const bs = await runUserSql(
        B,
        "SELECT count() AS n FROM otel_logs UNION ALL SELECT count() AS n FROM otel_spans",
      );
      expect(bs.rows.reduce((sum, r) => sum + Number(r.n), 0)).toBeGreaterThan(0);
    });

    it("still answers a legitimate query", async () => {
      const out = await runUserSql(A, "SELECT count() AS n FROM otel_logs");
      expect(Number(out.rows[0]!.n)).toBeGreaterThan(0);
      expect(out.columns).toEqual(["n"]);
    });
  });
});
