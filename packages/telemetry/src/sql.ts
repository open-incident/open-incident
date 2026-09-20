/**
 * The SQL console, and the reason it is not just "run what they typed".
 *
 * A column store's own query language is the honest end of an explorer: every
 * question somebody has that the filters do not cover is a question they can
 * answer themselves, and refusing them that turns the product into a wall.
 *
 * But a query the reader wrote is a query that can name any table in the
 * cluster, and every table in this cluster holds every workspace's rows. So
 * the console does not pass text through. It **rewrites** it: each table name
 * it recognises becomes the parameterized view for that table, which does not
 * compile without a tenant, and anything it does not recognise is refused by
 * name. The result goes through `read()` like every other query, so the
 * binding is done by the layer and not by this file.
 *
 * The refusals are deliberately loud. A console that silently narrowed a query
 * would be worse than one that refuses it: the reader would draw conclusions
 * from a result they did not ask for.
 */
import {
  EXCEPTIONS,
  EXCEPTION_GROUPS,
  LOGS,
  MINUTES,
  SERIES,
  SPANS,
  TRACES,
  read,
  type ReadOptions,
} from "./query";
import { EDGES } from "./service-map";

export class SqlError extends Error {}

/**
 * What a query may name, and what it becomes.
 *
 * The left-hand names are the ones the schema documentation uses, because that
 * is what somebody will type. The right-hand values are the only spelling that
 * carries a tenant.
 */
const TABLES: Record<string, string> = {
  otel_logs: LOGS,
  otel_spans: SPANS,
  otel_traces: TRACES,
  otel_traces_index: TRACES,
  otel_exceptions: EXCEPTIONS,
  exception_groups: EXCEPTION_GROUPS,
  metric_series: SERIES,
  metric_1m: MINUTES,
  service_edges: EDGES,
  service_edges_1m: EDGES,
};

export const SQL_TABLES = Object.keys(TABLES);

/**
 * Statements that are not a question, and clauses that undo the caps.
 *
 * `settings` and `format` are here for the second reason and they are the
 * subtle ones: `SETTINGS max_result_rows = 0` hands the reader back every row
 * the caps were there to withhold, and a trailing `FORMAT` changes what the
 * client is decoding underneath itself. Neither is a write, and both were
 * getting through until a test asked.
 */
const FORBIDDEN =
  /\b(insert|alter|drop|create|attach|detach|truncate|optimize|rename|exchange|grant|revoke|kill|system|set|settings|delete|update|use|format|outfile|infile)\b/i;

export const MAX_ROWS = 1_000;
export const TIMEOUT_SECONDS = 20;

export type SqlResult = { columns: string[]; rows: Array<Record<string, unknown>> };

/**
 * A query the reader wrote, into one this layer will run.
 *
 * Throws `SqlError` with a sentence naming what was wrong, because the whole
 * value of a console is that a refusal teaches you the next query.
 */
export function compileUserSql(input: string): string {
  const sql = input.trim().replace(/;\s*$/, "");
  if (!sql) throw new SqlError("the query is empty");
  if (sql.includes(";")) {
    throw new SqlError("one statement at a time — the semicolon is what splits two");
  }
  if (!/^(select|with)\b/i.test(sql)) {
    throw new SqlError("only SELECT is allowed here; this console reads and never writes");
  }
  const forbidden = FORBIDDEN.exec(sql);
  if (forbidden) {
    throw new SqlError(
      `"${forbidden[1]}" is not allowed here; this console reads and never writes`,
    );
  }

  /*
   * Every table named after FROM or JOIN has to be one we know.
   *
   * A subquery or a CTE is followed by `(`, and an alias defined by a `WITH`
   * is matched here too — so those are collected first and let through. What
   * is left is a bare name, and a bare name we do not recognise is refused
   * rather than passed to ClickHouse, which would happily read `system.tables`
   * or another workspace's rows out of a raw table.
   */
  const ctes = new Set(
    [...sql.matchAll(/\b(?:with|,)\s+([a-z_][\w]*)\s+as\s*\(/gi)].map((m) => m[1]!.toLowerCase()),
  );

  let out = sql;
  const refs = [...sql.matchAll(/\b(from|join)\s+(?!\()\s*([a-zA-Z_][\w.]*)/gi)];
  for (const ref of refs) {
    const name = ref[2]!;
    const lower = name.toLowerCase();
    if (ctes.has(lower)) continue;
    if (lower.includes(".")) {
      throw new SqlError(
        `"${name}" names a database, and this console only reads this workspace's telemetry`,
      );
    }
    const view = TABLES[lower];
    if (!view) {
      throw new SqlError(
        `"${name}" is not a table you can read; the ones you can are ${SQL_TABLES.join(", ")}`,
      );
    }
    // Whole word, so `otel_logs` in `otel_logs_extra` is not rewritten — that
    // name would have been refused above anyway, and a partial rewrite would
    // produce a query nobody wrote.
    out = out.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, "g"), view);
  }
  if (refs.length === 0) {
    throw new SqlError(`the query reads no table; name one of ${SQL_TABLES.join(", ")} after FROM`);
  }
  return out;
}

/** Runs a reader's query through the tenant layer and caps what comes back. */
export async function runUserSql(
  tenantId: string,
  input: string,
  opts: ReadOptions = {},
): Promise<SqlResult> {
  const rows = await read<Record<string, unknown>>(tenantId, compileUserSql(input), {
    maxRows: MAX_ROWS,
    timeoutSeconds: TIMEOUT_SECONDS,
    ...opts,
  });
  // The columns come from the first row rather than from the statement: a
  // SELECT * has no column list to read, and the alternative is a second query
  // asking ClickHouse to describe it.
  return { columns: rows[0] ? Object.keys(rows[0]) : [], rows };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
