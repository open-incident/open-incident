/**
 * The one-line filter language, shared by the explorers and the monitors.
 *
 * In its own module because both use it, and because they must not drift: a
 * filter somebody typed into the Logs screen to find a problem is a filter
 * they turn into a monitor with one click, and a language that behaves
 * differently in the two places is a language nobody trusts in either.
 *
 * It started as one line — `field op value`, joined by `AND` — on the argument
 * that a monitor needing boolean algebra is a monitor nobody can read at three
 * in the morning. That holds for a monitor and does not hold for a search: an
 * investigation is exactly "these two services, either of these statuses, and
 * not the health check", and a language that cannot say it sends people to the
 * SQL console for questions a filter box should answer.
 *
 * So the grammar now has `OR`, `NOT`, parentheses, `IN (…)` and
 * `exists` / `missing`, and nothing else. Every field is still chosen from a
 * fixed list and every value still travels as a bound parameter — the shape
 * that makes an injection impossible rather than escaped.
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
type Column = {
  sql: string;
  numeric: boolean;
  /**
   * How to ask whether the field is there at all.
   *
   * An attribute either is in the map or is not, which is a different question
   * from being empty — and the only one worth asking, because a filter on
   * `attr:pool.waiters` should find the spans that recorded it rather than the
   * spans where it happens to be non-empty.
   */
  exists?: string;
  /**
   * A flag, which nobody writes as `= 1`.
   *
   * ClickHouse compares a Bool against 1 and 0; a person types `true`. The
   * translation is here rather than in the reader's head.
   */
  bool?: boolean;
};

const COLUMNS: Record<FilterKind, Record<string, Column>> = {
  logs: {
    service_name: { sql: "service_name", numeric: false },
    environment: { sql: "environment", numeric: false },
    severity_number: { sql: "severity_number", numeric: true },
    severity_text: { sql: "severity_text", numeric: false },
    body: { sql: "body", numeric: false },
    trace_id: { sql: "trace_id", numeric: false },
    // Stored since the first migration and never filterable until now: it is
    // what "the logs of this span" means, and a trace id alone gives the logs
    // of every span in the request.
    span_id: { sql: "span_id", numeric: false },
    /** Which instrumentation wrote the line — an SDK, a logger, a receiver. */
    scope_name: { sql: "scope_name", numeric: false },
  },
  /*
   * Every column the spans table actually has.
   *
   * It had seven of them exposed and eleven more sitting in the table. A
   * filter language that cannot say `http_route = '/checkout'` on a store that
   * indexes `http_route` is not a language limit, it is an omission — and it
   * sends people to the SQL console to ask what the filter box is for.
   */
  traces: {
    service_name: { sql: "service_name", numeric: false },
    service_version: { sql: "service_version", numeric: false },
    environment: { sql: "environment", numeric: false },
    name: { sql: "name", numeric: false },
    kind: { sql: "kind", numeric: false },
    status_code: { sql: "status_code", numeric: false },
    status_message: { sql: "status_message", numeric: false },
    // Exposed in milliseconds because that is the unit a person writes a
    // threshold in. Nobody has ever meant "above 250000000 nanoseconds".
    duration_ms: { sql: "(duration_ns / 1000000)", numeric: true },
    http_method: { sql: "http_method", numeric: false },
    http_route: { sql: "http_route", numeric: false },
    http_status_code: { sql: "http_status_code", numeric: true },
    db_system: { sql: "db_system", numeric: false },
    rpc_service: { sql: "rpc_service", numeric: false },
    peer_service: { sql: "peer_service", numeric: false },
    has_exception: { sql: "has_exception", numeric: false, bool: true },
    trace_id: { sql: "trace_id", numeric: false },
    span_id: { sql: "span_id", numeric: false },
    parent_span_id: { sql: "parent_span_id", numeric: false },
  },
  metrics: {},
  exceptions: {
    service_name: { sql: "service_name", numeric: false },
    environment: { sql: "environment", numeric: false },
    release: { sql: "release", numeric: false },
    type: { sql: "type", numeric: false },
    message: { sql: "message", numeric: false },
    fingerprint: { sql: "fingerprint", numeric: false },
    stacktrace: { sql: "stacktrace", numeric: false },
    trace_id: { sql: "trace_id", numeric: false },
    span_id: { sql: "span_id", numeric: false },
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
    return {
      sql: `attributes[{${name}:String}]`,
      numeric: false,
      exists: `has(attributes, {${name}:String})`,
    };
  }
  const column = COLUMNS[kind][field.trim()];
  if (!column) {
    throw new TelemetryFilterError(
      `"${field}" is not a field of ${kind}; use one of ${fieldsOf(kind).join(", ")} or attr:<name>`,
    );
  }
  return column;
}

/* ---------------------------------------------------------------------------
 * The grammar, as a recursive descent.
 *
 *   expr   := or
 *   or     := and ( OR and )*
 *   and    := not ( AND not )*
 *   not    := NOT not | atom
 *   atom   := '(' expr ')' | term
 *   term   := field op value
 *           | field IN '(' value ( ',' value )* ')'
 *           | field ( exists | missing )
 *
 * A tokenizer rather than a regular expression per clause, because the moment
 * a language has parentheses a regular expression is the wrong tool and every
 * bug it produces is a silently wrong query.
 * ------------------------------------------------------------------------- */

type Tok =
  | { kind: "word"; value: string }
  | { kind: "string"; value: string }
  | { kind: "number"; value: string }
  | { kind: "op"; value: string }
  | { kind: "(" }
  | { kind: ")" }
  | { kind: "," };

const OPERATORS = ["=~", "!~", ">=", "<=", "!=", "==", "=", ">", "<"] as const;
/** A field name, or an attribute reference. Anything else is not a field. */
const FIELD = /^[A-Za-z_][\w.]*(?::[\w.\-/]+)?$/;

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      out.push(c === "," ? { kind: "," } : { kind: c === "(" ? "(" : ")" });
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = text.indexOf(c, i + 1);
      if (end < 0)
        throw new TelemetryFilterError(`a quote is opened and never closed: ${text.slice(i)}`);
      out.push({ kind: "string", value: text.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const op = OPERATORS.find((o) => text.startsWith(o, i));
    if (op) {
      out.push({ kind: "op", value: op });
      i += op.length;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(text[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < text.length && /[0-9._eE+-]/.test(text[j]!)) j++;
      out.push({ kind: "number", value: text.slice(i, j) });
      i = j;
      continue;
    }
    let j = i;
    while (
      j < text.length &&
      /[^\s(),]/.test(text[j]!) &&
      !OPERATORS.some((o) => text.startsWith(o, j))
    )
      j++;
    if (j === i) throw new TelemetryFilterError(`cannot read "${text.slice(i)}"`);
    out.push({ kind: "word", value: text.slice(i, j) });
    i = j;
  }
  return out;
}

class Parser {
  #toks: Tok[];
  #at = 0;
  #kind: FilterKind;
  #params: Record<string, unknown>;

  constructor(kind: FilterKind, toks: Tok[], params: Record<string, unknown>) {
    this.#kind = kind;
    this.#toks = toks;
    this.#params = params;
  }

  #peek(): Tok | undefined {
    return this.#toks[this.#at];
  }

  #word(...words: string[]): boolean {
    const tok = this.#peek();
    return tok?.kind === "word" && words.includes(tok.value.toLowerCase());
  }

  #take(): Tok {
    const tok = this.#toks[this.#at++];
    if (!tok) throw new TelemetryFilterError("the filter stops in the middle of a term");
    return tok;
  }

  /** A fresh parameter name, numbered across everything already bound. */
  #bind(value: unknown): string {
    const name = `f${Object.keys(this.#params).length}`;
    this.#params[name] = value;
    return name;
  }

  parse(): string {
    const sql = this.#or();
    if (this.#at < this.#toks.length) {
      const tok = this.#peek()!;
      const shown = tok.kind === "(" || tok.kind === ")" || tok.kind === "," ? tok.kind : tok.value;
      throw new TelemetryFilterError(`"${shown}" is not expected here`);
    }
    return sql;
  }

  #or(): string {
    const parts = [this.#and()];
    while (this.#word("or")) {
      this.#at++;
      parts.push(this.#and());
    }
    return parts.length === 1 ? parts[0]! : parts.map((p) => `(${p})`).join(" OR ");
  }

  #and(): string {
    const parts = [this.#not()];
    while (this.#word("and")) {
      this.#at++;
      parts.push(this.#not());
    }
    return parts.join(" AND ");
  }

  #not(): string {
    if (this.#word("not")) {
      this.#at++;
      return `NOT (${this.#not()})`;
    }
    return this.#atom();
  }

  #atom(): string {
    if (this.#peek()?.kind === "(") {
      this.#at++;
      const inner = this.#or();
      if (this.#peek()?.kind !== ")")
        throw new TelemetryFilterError("a parenthesis is never closed");
      this.#at++;
      return `(${inner})`;
    }
    return this.#term();
  }

  #term(): string {
    const head = this.#take();
    if (head.kind !== "word" || !FIELD.test(head.value)) {
      const shown = "value" in head ? head.value : head.kind;
      throw new TelemetryFilterError(
        `"${shown}" is not a field; a term is "field = value", and a field is one of ` +
          `${fieldsOf(this.#kind).join(", ")} or attr:<name>`,
      );
    }
    const field = head.value;
    const column = columnOf(this.#kind, field, this.#params);

    if (this.#word("exists", "missing")) {
      const missing = (this.#take() as { value: string }).value.toLowerCase() === "missing";
      if (!column.exists && column.numeric) {
        throw new TelemetryFilterError(
          `${field} is a number that is always there; "exists" applies to an attribute`,
        );
      }
      const present = column.exists ?? `${column.sql} != ''`;
      return missing ? `NOT (${present})` : present;
    }

    if (this.#word("in", "not_in")) {
      const negated = (this.#take() as { value: string }).value.toLowerCase() === "not_in";
      if (this.#peek()?.kind !== "(")
        throw new TelemetryFilterError(`"in" is followed by (a, b, c)`);
      this.#at++;
      const values: string[] = [];
      for (;;) {
        const tok = this.#take();
        if (tok.kind === ")") break;
        if (tok.kind === ",") continue;
        if (!("value" in tok)) throw new TelemetryFilterError(`"in" takes values, not ${tok.kind}`);
        values.push(tok.value);
      }
      if (values.length === 0)
        throw new TelemetryFilterError(`"in ()" matches nothing; name a value`);
      if (column.numeric) {
        const numbers = values.map((v) => {
          const n = Number(v);
          if (!Number.isFinite(n))
            throw new TelemetryFilterError(`${field} is a number, and "${v}" is not one`);
          return n;
        });
        const name = this.#bind(numbers);
        return `${negated ? "NOT " : ""}${column.sql} IN {${name}:Array(Float64)}`;
      }
      const name = this.#bind(values);
      return `${negated ? "NOT " : ""}${column.sql} IN {${name}:Array(String)}`;
    }

    const opTok = this.#take();
    if (opTok.kind === "word" && opTok.value.toLowerCase() === "contains") {
      const name = this.#bind(this.#value());
      return `positionCaseInsensitive(${column.sql}, {${name}:String}) > 0`;
    }
    if (opTok.kind !== "op") {
      const shown = "value" in opTok ? opTok.value : opTok.kind;
      throw new TelemetryFilterError(`"${shown}" is not an operator`);
    }
    const op = opTok.value;

    if (op === "=~" || op === "!~") {
      const name = this.#bind(this.#value());
      return `${op === "!~" ? "NOT " : ""}match(${column.sql}, {${name}:String})`;
    }
    const literal = this.#value();
    if (column.bool) {
      if (op !== "=" && op !== "==" && op !== "!=") {
        throw new TelemetryFilterError(`${field} is true or false, so ${op} does not apply to it`);
      }
      const truthy = ["true", "yes", "1"].includes(literal.toLowerCase());
      const falsy = ["false", "no", "0"].includes(literal.toLowerCase());
      if (!truthy && !falsy) {
        throw new TelemetryFilterError(`${field} is true or false, and "${literal}" is neither`);
      }
      const name = this.#bind(truthy ? 1 : 0);
      return `${column.sql} ${op === "!=" ? "!=" : "="} {${name}:UInt8}`;
    }
    if (column.numeric) {
      const n = Number(literal);
      if (!Number.isFinite(n)) {
        throw new TelemetryFilterError(`${field} is a number, and "${literal}" is not one`);
      }
      const name = this.#bind(n);
      return `${column.sql} ${op === "==" ? "=" : op} {${name}:Float64}`;
    }
    if (op !== "=" && op !== "==" && op !== "!=") {
      throw new TelemetryFilterError(`${field} holds text, so ${op} does not apply to it`);
    }
    const name = this.#bind(literal);
    return `${column.sql} ${op === "!=" ? "!=" : "="} {${name}:String}`;
  }

  #value(): string {
    const tok = this.#take();
    if (tok.kind === "string" || tok.kind === "number" || tok.kind === "word") return tok.value;
    throw new TelemetryFilterError(`a value is expected, not ${tok.kind}`);
  }
}

/**
 * A filter expression into a `WHERE` clause.
 *
 * Every field comes from the allowlist and every value is bound, so the worst
 * a hostile filter can do is fail to parse. An empty filter is every row: a
 * form field somebody has not typed in is not an error.
 */
export function compileFilter(kind: FilterKind, expression: string): Bound {
  const params: Record<string, unknown> = {};
  const text = expression.trim();
  if (!text) return { sql: "1 = 1", params };
  const sql = new Parser(kind, tokenize(text), params).parse();
  return { sql, params };
}
