/**
 * The SQL console's compiler, which is the only thing between a query
 * somebody typed and every workspace's rows.
 *
 * The tests are written as the two ways it could fail. It could let something
 * through — a raw table, another database, a statement that writes — and the
 * tests for that are the interesting half. Or it could refuse a legitimate
 * query, and a console that refuses what it should answer is a console nobody
 * opens twice.
 */
import { describe, expect, it } from "vitest";
import { SqlError, SQL_TABLES, compileUserSql } from "../src/sql";

describe("a table name becomes a tenant view", () => {
  it("rewrites the table the reader named", () => {
    const out = compileUserSql("SELECT count() FROM otel_logs");
    expect(out).toContain("otel_logs_t(tenant = {tenant:UUID})");
    expect(out).not.toMatch(/FROM otel_logs\b/);
  });

  it("rewrites every mention, not only the first", () => {
    const out = compileUserSql(
      "SELECT a.service_name FROM otel_spans AS a JOIN otel_logs AS b ON a.trace_id = b.trace_id",
    );
    expect(out).toContain("otel_spans_t(tenant = {tenant:UUID})");
    expect(out).toContain("otel_logs_t(tenant = {tenant:UUID})");
  });

  it("lets a subquery through", () => {
    const out = compileUserSql(
      "SELECT n FROM (SELECT count() AS n FROM otel_logs WHERE severity_number >= 17)",
    );
    expect(out).toContain("otel_logs_t(tenant = {tenant:UUID})");
  });

  it("lets a WITH clause name itself", () => {
    const out = compileUserSql(
      "WITH errors AS (SELECT * FROM otel_logs WHERE severity_number >= 17) SELECT count() FROM errors",
    );
    expect(out).toContain("otel_logs_t(tenant = {tenant:UUID})");
  });

  it("accepts every table it advertises", () => {
    for (const table of SQL_TABLES) {
      expect(() => compileUserSql(`SELECT * FROM ${table} LIMIT 1`)).not.toThrow();
    }
  });
});

describe("what it refuses", () => {
  const refuses = (sql: string, why: RegExp) => {
    expect(() => compileUserSql(sql)).toThrow(SqlError);
    expect(() => compileUserSql(sql)).toThrow(why);
  };

  it("refuses anything that is not a question", () => {
    refuses("INSERT INTO otel_logs VALUES (1)", /only SELECT/);
    refuses("DROP TABLE otel_logs", /only SELECT/);
  });

  it("refuses a write hidden after a legitimate opening", () => {
    // The keyword check runs on the whole statement, not only on its first
    // word: a query that opens as a SELECT and reaches somewhere else further
    // in is the shape this has to catch.
    refuses("SELECT * FROM otel_logs UNION ALL SELECT * FROM system.tables", /"system"/);
    // SETTINGS is not a write, and that is exactly why it is easy to miss:
    // `max_result_rows = 0` hands back every row the caps withheld.
    refuses(
      "WITH x AS (SELECT 1) SELECT * FROM otel_logs SETTINGS max_result_rows = 0",
      /"SETTINGS"/,
    );
  });

  it("refuses a second statement", () => {
    refuses("SELECT 1 FROM otel_logs; DROP TABLE otel_logs", /one statement at a time/);
  });

  it("refuses another database, which is how a cluster is read", () => {
    // `system` is caught by the keyword check before the dotted name is even
    // looked at; every other database is caught by the dot.
    refuses("SELECT * FROM system.parts", /"system"/);
    refuses("SELECT * FROM default.otel_logs", /names a database/);
  });

  it("answers a legitimate query that happens to carry a comment", () => {
    expect(() => compileUserSql("SELECT count() FROM otel_logs -- how many")).not.toThrow();
  });

  it("refuses a table it does not know rather than passing it through", () => {
    // The whole guarantee: an unrecognised name never reaches ClickHouse,
    // because the raw tables hold every workspace's rows.
    refuses("SELECT * FROM otel_logs_raw", /not a table you can read/);
    refuses("SELECT * FROM users", /not a table you can read/);
  });

  it("refuses a query that reads nothing", () => {
    refuses("SELECT 1", /reads no table/);
    refuses("   ", /empty/);
  });

  it("does not rewrite a longer name that merely starts the same", () => {
    // `otel_logs_archive` is refused by name; the point is that it is never
    // half-rewritten into something the reader did not write.
    expect(() => compileUserSql("SELECT * FROM otel_logs_archive")).toThrow(
      /not a table you can read/,
    );
  });
});
