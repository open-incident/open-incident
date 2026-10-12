import Link from "next/link";
import { attributeKeys, facetsFor, type FacetValue } from "@openincident/telemetry";
import { getT } from "@/i18n/server";

/**
 * What is in this window, beside what was asked for.
 *
 * The filter box answers "show me the spans where X". It cannot answer "what
 * is X, here, today" — and that is the question somebody actually arrives
 * with. So the rail counts the window: 61 % of it is one service, 2 % of it
 * returned 502, and clicking the 2 % is how a search gets refined by somebody
 * who does not yet know the field names.
 *
 * Every value is a link that adds one term to the filter, so the filter box
 * stays the single description of what is on screen — no hidden state, and the
 * expression can be read, edited, saved as a monitor, or pasted to a
 * colleague. A rail with its own private selection would be a second source of
 * truth for the same question.
 *
 * The counts are exact and cost one pass over the window (85 ms over a day of
 * 1.4 million spans). Only low-cardinality fields are offered: a facet over
 * `trace_id` would be one row per value, which is the thing this must never do.
 */
export async function FacetRail({
  kind,
  tenantId,
  from,
  to,
  filter,
  service,
  link,
}: {
  kind: "logs" | "traces" | "exceptions";
  tenantId: string;
  from: Date;
  to: Date;
  filter?: string;
  service?: string;
  link: (over: Record<string, string | undefined>) => string;
}) {
  const t = await getT();
  let data: Awaited<ReturnType<typeof facetsFor>> = {
    total: 0,
    facets: [],
    scanned: { from, to, whole: true },
  };
  let attrs: FacetValue[] = [];
  try {
    [data, attrs] = await Promise.all([
      facetsFor(kind, tenantId, { from, to, filter, service }),
      attributeKeys(kind, tenantId, { from, to, filter, service, limit: 8 }),
    ]);
  } catch {
    // A rail that cannot count still holds its place: the list beside it
    // reports the filter error on its own, and the layout must not collapse.
    data = { total: 0, facets: [], scanned: { from, to, whole: true } };
  }

  const terms = (filter ?? "")
    .split(/\s+AND\s+/i)
    .map((x) => x.trim())
    .filter(Boolean);
  const termOf = (field: string, value: string) => `${field} = '${value.replace(/'/g, "")}'`;
  /** A value already in the filter is removed by a click; any other is added. */
  const toggle = (field: string, value: string) => {
    const term = termOf(field, value);
    const next = terms.includes(term) ? terms.filter((x) => x !== term) : [...terms, term];
    return link({ q: next.join(" AND ") || undefined, before: undefined });
  };

  /*
   * The field browser, after Sumo Logic's: one panel beside the results, a
   * section per field with how many values it has, the values with their
   * share, and the ones already in the filter marked — clicking them takes
   * them out. Sticky, and scrolled on its own, so the fields stay in reach
   * while the results scroll.
   */
  return (
    <aside
      data-testid="facet-rail"
      className="oi-panel"
      style={{
        position: "sticky",
        top: 12,
        alignSelf: "start",
        maxHeight: "calc(100vh - 150px)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "11px 14px 9px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          position: "sticky",
          top: 0,
          background: "var(--panel)",
          zIndex: 1,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("facets.title")}</span>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {data.scanned.whole
            ? t("facets.total", { count: data.total })
            : /*
               * Said, never silently. Counting a week of 22 million spans
               * exactly is 4.6 s, so past six hours the rail counts the most
               * recent six — which is a true answer to "what is in here", as
               * long as it says which "here".
               */
              t("facets.totalPartial", {
                count: data.total,
                hours: Math.round(
                  (data.scanned.to.getTime() - data.scanned.from.getTime()) / 3_600_000,
                ),
              })}
        </span>
      </div>

      {data.facets.length === 0 && (
        <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--ink-3)" }}>
          {t("facets.none")}
        </div>
      )}

      {data.facets.map((facet) => (
        <details
          key={facet.field}
          open
          style={{ borderBottom: "1px solid var(--line-2)", padding: "8px 14px" }}
        >
          <summary
            style={{
              cursor: "pointer",
              listStyle: "none",
              display: "flex",
              alignItems: "baseline",
              gap: 6,
              marginBottom: 4,
            }}
          >
            <span aria-hidden style={{ fontSize: 9, color: "var(--ink-3)" }}>
              ▾
            </span>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--ink)",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
              }}
            >
              {facet.field}
            </span>
            <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{facet.distinct}</span>
          </summary>
          {facet.values.map((v) => {
            const on = terms.includes(termOf(facet.field, v.value));
            return (
              <Link
                key={v.value}
                href={toggle(facet.field, v.value)}
                data-testid="facet-value"
                aria-pressed={on}
                title={t(on ? "facets.remove" : "facets.add", {
                  field: facet.field,
                  value: v.value,
                })}
                className={on ? undefined : "oi-hover"}
                style={{
                  display: "grid",
                  gridTemplateColumns: "14px minmax(0,1fr) 44px",
                  gap: 6,
                  alignItems: "center",
                  padding: "3px 4px",
                  margin: "0 -4px",
                  borderRadius: 6,
                  fontSize: 12,
                  textDecoration: "none",
                  color: "var(--ink)",
                  background: on ? "var(--brand-t)" : undefined,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 3,
                    border: `1.5px solid ${on ? "var(--brand)" : "var(--line)"}`,
                    background: on ? "var(--brand)" : "transparent",
                  }}
                />
                <span
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {v.value}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    color: "var(--ink-3)",
                    textAlign: "right",
                  }}
                >
                  {share(v.share)}
                </span>
                {/* The bar is the share again, for the eye rather than the reader. */}
                <span
                  aria-hidden
                  style={{
                    gridColumn: "2 / -1",
                    height: 2,
                    borderRadius: 2,
                    background: "var(--line-2)",
                    overflow: "hidden",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      width: `${Math.max(2, v.share * 100)}%`,
                      background: "var(--brand)",
                      opacity: 0.55,
                    }}
                  />
                </span>
              </Link>
            );
          })}
        </details>
      ))}

      {attrs.length > 0 && (
        <details open style={{ padding: "8px 14px 12px" }}>
          <summary
            style={{
              cursor: "pointer",
              listStyle: "none",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginBottom: 4,
            }}
          >
            {t("facets.attributes")}
          </summary>
          {/*
            Keys, not values. What the instrumentation put in the map is
            unbounded — a user id, a cart total — so the panel says which
            attributes are here and the filter asks for one of them.
          */}
          {attrs.map((a) => (
            <Link
              key={a.value}
              href={link({
                q: `${filter?.trim() ? `${filter.trim()} AND ` : ""}attr:${a.value} exists`,
                before: undefined,
              })}
              data-testid="facet-attribute"
              className="oi-hover"
              style={{
                display: "block",
                padding: "3px 4px",
                margin: "0 -4px",
                borderRadius: 6,
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                color: "var(--ink-2)",
                textDecoration: "none",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {a.value}
            </Link>
          ))}
        </details>
      )}
    </aside>
  );
}

/**
 * "61 %", "9,9 %", "<1 %" — a share nobody has to divide in their head.
 *
 * Rounded before it is compared, not after: 9.95 read as "10,0 %" on a column
 * sized for "10 %" and wrapped onto two lines.
 */
function share(value: number): string {
  const pct = value * 100;
  if (Math.round(pct) >= 10) return `${Math.round(pct)} %`;
  if (pct >= 1) return `${pct.toFixed(1).replace(".", ",")} %`;
  return pct > 0 ? "<1 %" : "0 %";
}
