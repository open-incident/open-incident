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
    // A rail that cannot count is a rail that says nothing — never a page that
    // fails. The list beside it reports the filter error on its own.
    return null;
  }

  if (data.facets.length === 0) return null;

  /** One more term, joined to what is already there. */
  const withTerm = (field: string, value: string) => {
    const term = `${field} = '${value.replace(/'/g, "")}'`;
    const next = filter?.trim() ? `${filter.trim()} AND ${term}` : term;
    return link({ q: next, before: undefined });
  };

  return (
    <aside
      data-testid="facet-rail"
      style={{ display: "flex", flexDirection: "column", gap: 14, alignSelf: "start" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span className="oi-eyebrow">{t("facets.title")}</span>
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

      {data.facets.map((facet) => (
        <div key={facet.field} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--ink-2)",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {facet.field}
            </span>
            <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{facet.distinct}</span>
          </div>
          {facet.values.map((v) => (
            <Link
              key={v.value}
              href={withTerm(facet.field, v.value)}
              data-testid="facet-value"
              title={t("facets.add", { field: facet.field, value: v.value })}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) 44px",
                gap: 6,
                alignItems: "center",
                padding: "1px 0",
                fontSize: 11.5,
                textDecoration: "none",
                color: "var(--ink)",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                  gridColumn: "1 / -1",
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
                    opacity: 0.6,
                  }}
                />
              </span>
            </Link>
          ))}
        </div>
      ))}

      {attrs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span className="oi-eyebrow">{t("facets.attributes")}</span>
          {/*
            Keys, not values. What the instrumentation put in the map is
            unbounded — a user id, a cart total — so the rail says which
            attributes are here and the filter box asks for one of them.
          */}
          {attrs.map((a) => (
            <Link
              key={a.value}
              href={link({
                q: `${filter?.trim() ? `${filter.trim()} AND ` : ""}attr:${a.value} exists`,
                before: undefined,
              })}
              data-testid="facet-attribute"
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
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
        </div>
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
