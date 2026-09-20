import { getT } from "@/i18n/server";
import { SQL_MAX_ROWS, SQL_TABLES, SqlError, runUserSql } from "@/lib/telemetry";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};
const MONO: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 12 };

const EXAMPLES = [
  "SELECT service_name, count() AS n\n  FROM otel_logs\n WHERE severity_number >= 17\n GROUP BY service_name\n ORDER BY n DESC",
  "SELECT name, quantile(0.95)(duration_ns) / 1000000 AS p95_ms\n  FROM otel_spans\n WHERE start_ts >= now() - INTERVAL 1 HOUR\n GROUP BY name\n ORDER BY p95_ms DESC\n LIMIT 20",
  "SELECT type, message, occurrences\n  FROM exception_groups\n ORDER BY occurrences DESC\n LIMIT 20",
];

/**
 * The SQL console.
 *
 * Every explorer answers the questions somebody thought of when it was built.
 * This one answers the rest — and is the difference between a product you can
 * work with and a product you hit a wall in. A reader who knows SQL should not
 * have to export their own telemetry to ask it something.
 *
 * What they type never reaches ClickHouse unchanged: the table names are
 * rewritten to the parameterized views, which do not compile without a tenant,
 * and a name that is not one of ours is refused rather than passed on. A
 * refusal names what was wrong, because in a console the error is most of the
 * teaching.
 */
export async function SqlTab({ tenantId, query }: { tenantId: string; query?: string }) {
  const t = await getT();
  let result: Awaited<ReturnType<typeof runUserSql>> | null = null;
  let error: string | null = null;

  if (query?.trim()) {
    try {
      result = await runUserSql(tenantId, query);
    } catch (err) {
      // A SqlError is the console's own refusal and is written for the reader.
      // Anything else came from ClickHouse, and its message is the honest
      // thing to show: the reader wrote the query, they can read the answer.
      error =
        err instanceof SqlError
          ? err.message
          : err instanceof Error
            ? err.message.split("\n")[0]!.slice(0, 400)
            : String(err);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <form method="get" action="/app/telemetry" style={{ ...CARD, padding: "12px 14px" }}>
        <input type="hidden" name="tab" value="sql" />
        <textarea
          name="q"
          rows={7}
          data-testid="sql-query"
          defaultValue={query ?? ""}
          spellCheck={false}
          placeholder={EXAMPLES[0]}
          style={{
            ...MONO,
            width: "100%",
            border: "1px solid var(--line)",
            borderRadius: 9,
            padding: "10px 12px",
            background: "var(--sunk)",
            outline: "none",
            resize: "vertical",
            lineHeight: 1.55,
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            type="submit"
            data-testid="sql-run"
            className="oi-hover-brand-2"
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 9,
              background: "var(--brand)",
              color: "var(--on-brand)",
              border: 0,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("sql.run")}
          </button>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
            {t("sql.tables", { tables: SQL_TABLES.join(", ") })}
          </span>
        </div>
      </form>

      {error && (
        <div
          role="alert"
          data-testid="sql-error"
          style={{
            ...CARD,
            padding: "11px 14px",
            borderColor: "var(--dang)",
            background: "var(--dang-t)",
            color: "var(--dang)",
            fontSize: 12.5,
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      )}

      {result && !error && (
        <div style={{ ...CARD, overflow: "hidden" }} data-testid="sql-result">
          {result.rows.length === 0 ? (
            <div style={{ padding: "18px 16px", fontSize: 13, color: "var(--ink-3)" }}>
              {t("sql.noRows")}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", ...MONO }}>
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th
                        key={c}
                        style={{
                          textAlign: "left",
                          padding: "8px 12px",
                          borderBottom: "1px solid var(--line)",
                          fontSize: 11,
                          fontWeight: 700,
                          color: "var(--ink-3)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {result!.columns.map((c) => (
                        <td
                          key={c}
                          style={{
                            padding: "7px 12px",
                            borderBottom: "1px solid var(--line-2)",
                            maxWidth: 420,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {cell(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div
            style={{
              padding: "8px 12px",
              borderTop: "1px solid var(--line)",
              fontSize: 11.5,
              color: "var(--ink-3)",
            }}
          >
            {/*
              The cap is stated rather than left to be inferred. A reader who
              sees exactly a thousand rows and is not told why will believe
              that is how many there are.
            */}
            {result.rows.length >= SQL_MAX_ROWS
              ? t("sql.capped", { count: SQL_MAX_ROWS })
              : t("sql.rows", { count: result.rows.length })}
          </div>
        </div>
      )}

      {!result && !error && (
        <div
          style={{
            ...CARD,
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)" }}>
            {t("sql.examples")}
          </span>
          {EXAMPLES.map((example) => (
            <form key={example} method="get" action="/app/telemetry">
              <input type="hidden" name="tab" value="sql" />
              <input type="hidden" name="q" value={example} />
              <button
                type="submit"
                style={{
                  ...MONO,
                  fontSize: 11.5,
                  textAlign: "left",
                  width: "100%",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  background: "var(--sunk)",
                  color: "var(--ink-2)",
                  cursor: "pointer",
                  whiteSpace: "pre",
                  overflowX: "auto",
                }}
              >
                {example}
              </button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}

/** A cell, flattened. Arrays and objects arrive from Map and Array columns. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
