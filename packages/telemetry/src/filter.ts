/**
 * The one-line filter language, shared by the explorers and the monitors.
 *
 * In its own module because both use it, and because they must not drift: a
 * filter somebody typed into the Logs screen to find a problem is a filter
 * they turn into a monitor with one click, and a language that behaves
 * differently in the two places is a language nobody trusts in either.
 *
 * Deliberately one line long — `field op value`, joined by `AND`. A monitor
 * that needs boolean algebra is a monitor whose author will not be able to say
 * what it watches at three in the morning, and the SQL console is there for
 * the questions this cannot express.
 */

import { EXCEPTIONS, LOGS, SPANS } from "./views";

export type FilterKind = "logs" | "traces" | "metrics" | "exceptions";

export class TelemetryFilterError extends Error {}

/*
 * An allowlist rather than a parser that trusts its input.
 *
 * The filter is written by a person in a form field and ends up inside a
 * ClickHouse query, so the only safe shape is: the column names are chosen
 * from a fixed list and everything else is a bound parameter. `attr:foo`
 * reaches an attribute — the key travels as a parameter too.
 */
type Column = { sql: string; numeric: boolean };

const COLUMNS: Record<FilterKind, Record<string, Column>> = {
  logs: {
    service_name: { sql: "service_name", numeric: false },
    environment: { sql: "environment", numeric: false },
    severity_number: { sql: "severity_number", numeric: true },
    severity_text: { sql: "severity_text", numeric: false },
    body: { sql: "body", numeric: false },
    trace_id: { sql: "trace_id", numeric: false },
  },
  traces: {
    service_name: { sql: "service_name", numeric: false },
    environment: { sql: "environment", numeric: false },
    name: { sql: "name", numeric: false },
    kind: { sql: "kind", numeric: false },
    status_code: { sql: "status_code", numeric: false },
    // Exposed in milliseconds because that is the unit a person writes a
    // threshold in. Nobody has ever meant "above 250000000 nanoseconds".
    duration_ms: { sql: "(duration_ns / 1000000)", numeric: true },
    http_status_code: { sql: "http_status_code", numeric: true },
  },
  metrics: {},
  exceptions: {
    service_name: { sql: "service_name", numeric: false },
    environment: { sql: "environment", numeric: false },
    release: { sql: "release", numeric: false },
    type: { sql: "type", numeric: false },
    message: { sql: "message", numeric: false },
    fingerprint: { sql: "fingerprint", numeric: false },
  },
};

const SOURCES: Record<Exclude<FilterKind, "metrics">, { from: string; ts: string }> = {
  logs: { from: LOGS, ts: "ts" },
  traces: { from: SPANS, ts: "start_ts" },
  exceptions: { from: EXCEPTIONS, ts: "ts" },
};

export { SOURCES, columnOf };

/** The fields a filter or a `group by` may name, for the form's picker. */
export function fieldsOf(kind: FilterKind): string[] {
  return Object.keys(COLUMNS[kind]);
}

type Bound = { sql: string; params: Record<string, unknown> };

function columnOf(kind: FilterKind, field: string, params: Record<string, unknown>): Column {
  const attr = /^attr:(.+)$/.exec(field.trim());
  if (attr) {
    const name = `attr_${Object.keys(params).length}`;
    params[name] = attr[1];
    return { sql: `attributes[{${name}:String}]`, numeric: false };
  }
  const column = COLUMNS[kind][field.trim()];
  if (!column) {
    throw new TelemetryFilterError(
      `"${field}" is not a field of ${kind}; use one of ${fieldsOf(kind).join(", ")} or attr:<name>`,
    );
  }
  return column;
}

const TERM =
  /^\s*([A-Za-z_][\w.]*(?::[\w.-]+)?)\s*(=~|!~|>=|<=|!=|==|=|>|<|\bcontains\b)\s*(.+?)\s*$/i;

/**
 * A filter expression into a `WHERE` clause.
 *
 * The grammar is deliberately one line long — `field op value`, joined by
 * `AND` — because a monitor that needs boolean algebra is a monitor whose
 * author will not be able to say what it watches at three in the morning.
 * The metrics type has PromQL for the cases this cannot express.
 */
export function compileFilter(kind: FilterKind, expression: string): Bound {
  const params: Record<string, unknown> = {};
  const text = expression.trim();
  if (!text) return { sql: "1 = 1", params };

  const clauses: string[] = [];
  for (const raw of text.split(/\s+AND\s+/i)) {
    const m = TERM.exec(raw);
    if (!m) {
      throw new TelemetryFilterError(
        `cannot read "${raw.trim()}" — a filter is "field = value", joined by AND`,
      );
    }
    const [, field, rawOp, rawValue] = m as unknown as [string, string, string, string];
    const op = rawOp.toLowerCase();
    const column = columnOf(kind, field, params);
    const literal = unquote(rawValue);
    const name = `f${Object.keys(params).length}`;

    if (op === "contains") {
      params[name] = literal;
      clauses.push(`positionCaseInsensitive(${column.sql}, {${name}:String}) > 0`);
      continue;
    }
    if (op === "=~" || op === "!~") {
      params[name] = literal;
      clauses.push(`${op === "!~" ? "NOT " : ""}match(${column.sql}, {${name}:String})`);
      continue;
    }
    if (column.numeric) {
      const n = Number(literal);
      if (!Number.isFinite(n)) {
        throw new TelemetryFilterError(`${field} is a number, and "${literal}" is not one`);
      }
      params[name] = n;
      clauses.push(`${column.sql} ${op === "=" ? "=" : op} {${name}:Float64}`);
      continue;
    }
    if (op !== "=" && op !== "==" && op !== "!=") {
      throw new TelemetryFilterError(`${field} holds text, so ${op} does not apply to it`);
    }
    params[name] = literal;
    clauses.push(`${column.sql} ${op === "!=" ? "!=" : "="} {${name}:String}`);
  }
  return { sql: clauses.join(" AND "), params };
}

function unquote(value: string): string {
  const m = /^(['"])(.*)\1$/s.exec(value);
  return m ? (m[2] ?? "") : value;
}
