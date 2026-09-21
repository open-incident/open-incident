import { describe, expect, it } from "vitest";
import { TelemetryFilterError, compileFilter } from "../src/filter";

/**
 * The filter language, past one line.
 *
 * `OR`, `NOT`, parentheses, `IN` and `exists` are what an investigation
 * actually asks — "these two services, either of these statuses, and not the
 * health check". What every one of these tests is really checking is that the
 * expressiveness did not cost the property the language exists for: the field
 * comes from a fixed list, the value is always bound, and the worst a hostile
 * filter can do is fail to parse.
 */
describe("compileFilter", () => {
  it("joins an AND chain without parentheses it does not need", () => {
    const { sql } = compileFilter("traces", "service_name = 'api' AND duration_ms > 250");
    expect(sql).toBe("service_name = {f0:String} AND (duration_ns / 1000000) > {f1:Float64}");
  });

  it("parenthesises the branches of an OR, so precedence is visible in the SQL", () => {
    const { sql, params } = compileFilter(
      "traces",
      "service_name = 'api' AND status_code = 'error' OR http_status_code >= 500",
    );
    expect(sql).toBe(
      "(service_name = {f0:String} AND status_code = {f1:String}) OR (http_status_code >= {f2:Float64})",
    );
    expect(params).toEqual({ f0: "api", f1: "error", f2: 500 });
  });

  it("reads parentheses as written rather than as it pleases", () => {
    const { sql } = compileFilter(
      "traces",
      "service_name = 'api' AND (status_code = 'error' OR duration_ms > 2000)",
    );
    expect(sql).toBe(
      "service_name = {f0:String} AND ((status_code = {f1:String}) OR ((duration_ns / 1000000) > {f2:Float64}))",
    );
  });

  it("negates a whole term", () => {
    const { sql, params } = compileFilter("logs", "NOT service_name = 'health'");
    expect(sql).toBe("NOT (service_name = {f0:String})");
    expect(params.f0).toBe("health");
  });

  it("takes a list, as one bound array", () => {
    const { sql, params } = compileFilter("traces", "service_name in (checkout-api, 'payments')");
    expect(sql).toBe("service_name IN {f0:Array(String)}");
    expect(params.f0).toEqual(["checkout-api", "payments"]);
  });

  it("takes a list of numbers as numbers", () => {
    const { sql, params } = compileFilter("traces", "http_status_code in (500, 502, 504)");
    expect(sql).toBe("http_status_code IN {f0:Array(Float64)}");
    expect(params.f0).toEqual([500, 502, 504]);
  });

  /*
   * An attribute either is in the map or is not, which is not the same
   * question as being empty — and it is the one worth asking: a filter on
   * `attr:pool.waiters` looks for the spans that recorded it.
   */
  it("asks whether an attribute is there at all", () => {
    const { sql, params } = compileFilter("traces", "attr:pool.waiters exists");
    expect(sql).toBe("has(attributes, {attr_0:String})");
    expect(params).toEqual({ attr_0: "pool.waiters" });
    expect(compileFilter("traces", "attr:pool.waiters missing").sql).toBe(
      "NOT (has(attributes, {attr_0:String}))",
    );
  });

  it("asks the same of a column that can be blank", () => {
    expect(compileFilter("logs", "trace_id exists").sql).toBe("trace_id != ''");
  });

  it("refuses exists on a number, which is always there", () => {
    expect(() => compileFilter("logs", "severity_number exists")).toThrow(
      /applies to an attribute/,
    );
  });

  it("reads the whole thing a real investigation types", () => {
    const { sql, params } = compileFilter(
      "traces",
      "service_name in (checkout-api, payments-worker) AND (http_status_code >= 500 OR status_code = 'error') AND NOT attr:user.tier = 'free' AND attr:pool.waiters exists",
    );
    expect(() => sql).not.toThrow();
    expect(params.f0).toEqual(["checkout-api", "payments-worker"]);
    expect(sql).toContain("IN {f0:Array(String)}");
    expect(sql).toContain(" OR ");
    expect(sql).toContain("NOT (");
    expect(sql).toContain("has(attributes,");
  });

  describe("what it refuses, by name", () => {
    const cases: Array<[string, RegExp]> = [
      ["1=1 OR service_name = 'x'", /is not a field/],
      ["service_name = 'a' AND", /stops in the middle/],
      ["(service_name = 'a'", /never closed/],
      ["service_name = 'a')", /not expected here/],
      ["service_name 'a'", /is not an operator/],
      ["service_name in ()", /matches nothing/],
      ["service_name = 'unclosed", /never closed/],
      ["tenant_id = 'x'", /is not a field/],
      ["service_name > 'a'", /does not apply/],
      ["severity_number = 'high'", /not one/],
    ];
    for (const [input, message] of cases) {
      it(`refuses ${input}`, () => {
        expect(() => compileFilter("logs", input)).toThrow(TelemetryFilterError);
        expect(() => compileFilter("logs", input)).toThrow(message);
      });
    }
  });

  /*
   * The property the whole allowlist exists for. Every one of these is a
   * value, and a value is bound — so the SQL that reaches ClickHouse is the
   * same shape whatever somebody types.
   */
  it("binds an injection rather than escaping it", () => {
    for (const hostile of [
      "a' OR 1=1 --",
      "'; DROP TABLE otel_logs; --",
      "') OR (SELECT 1) = 1 AND ('a' = 'a",
    ]) {
      const { sql, params } = compileFilter("logs", `service_name = "${hostile}"`);
      expect(sql).toBe("service_name = {f0:String}");
      expect(params.f0).toBe(hostile);
    }
  });

  it("refuses a field name that tries to be SQL", () => {
    for (const hostile of [
      "attributes[1] = 'x'",
      "service_name) OR 1=1 --('a' = 'a",
      "body/**/ = 'x'",
    ]) {
      expect(() => compileFilter("logs", hostile)).toThrow(TelemetryFilterError);
    }
  });
});
