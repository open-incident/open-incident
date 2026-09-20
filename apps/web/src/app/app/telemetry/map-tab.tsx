import Link from "next/link";
import { getT } from "@/i18n/server";
import { layoutByDepth, serviceEdges, servicesSeen } from "@/lib/telemetry";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};
const MONO: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 12 };

/** The windows the map offers, in minutes. */
const WINDOWS = [60, 360, 1440] as const;

/**
 * The service map, drawn from the traces rather than from a list somebody kept.
 *
 * It is laid out in columns by depth rather than as a free-floating graph, and
 * that is a decision about reading rather than about drawing. A force-directed
 * cloud looks like a topology and answers no question: during an incident the
 * question is "what is downstream of this", and a left-to-right layout answers
 * it at a glance. Services nothing calls are on the left, and each column is
 * one hop further in.
 *
 * A dependency here is **observed** — it happened in the window being looked
 * at. One that stopped happening disappears, which is the honest behaviour: a
 * map that remembered every call ever made would show a topology that no
 * longer exists.
 */
export async function MapTab({
  tenantId,
  sinceMinutes = 60,
  highlight,
}: {
  tenantId: string;
  sinceMinutes?: number;
  /** The service the reader arrived from, picked out rather than filtered to. */
  highlight?: string;
}) {
  const t = await getT();
  const [edges, seen] = await Promise.all([
    serviceEdges(tenantId, { sinceMinutes }),
    servicesSeen(tenantId, sinceMinutes),
  ]);

  const windows = (
    <div style={{ display: "flex", gap: 6 }}>
      {WINDOWS.map((w) => (
        <Link
          key={w}
          href={`/app/telemetry?tab=map&since=${w}${highlight ? `&service=${encodeURIComponent(highlight)}` : ""}`}
          style={{
            fontSize: 12,
            padding: "4px 10px",
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: w === sinceMinutes ? "var(--panel)" : "transparent",
            color: w === sinceMinutes ? "var(--ink)" : "var(--ink-3)",
            fontWeight: w === sinceMinutes ? 600 : 400,
          }}
        >
          {t(w === 60 ? "map.last1h" : w === 360 ? "map.last6h" : "map.last24h")}
        </Link>
      ))}
    </div>
  );

  if (seen.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {windows}
        <div
          style={{
            ...CARD,
            padding: "28px 20px",
            textAlign: "center",
            color: "var(--ink-3)",
            fontSize: 13,
          }}
        >
          {t("map.noTraces")}
        </div>
      </div>
    );
  }

  const columns = layoutByDepth(
    edges,
    seen.map((s) => s.service_name),
  );
  const errorRate = new Map(
    seen.map((s) => [s.service_name, Number(s.n_errors) / Math.max(1, Number(s.spans))]),
  );
  const outgoing = new Map<string, typeof edges>();
  for (const e of edges) {
    const list = outgoing.get(e.source_service) ?? [];
    list.push(e);
    outgoing.set(e.source_service, list);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {windows}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
          {t("map.nServices", { count: seen.length })} · {t("map.nEdges", { count: edges.length })}
        </span>
      </div>

      {edges.length === 0 && (
        <div style={{ ...CARD, padding: "12px 14px", fontSize: 12.5, color: "var(--ink-2)" }}>
          {t("map.noEdges")}
        </div>
      )}

      <div style={{ ...CARD, padding: "18px 16px", overflowX: "auto" }}>
        <div
          style={{ display: "flex", gap: 28, alignItems: "flex-start", minWidth: "min-content" }}
        >
          {columns.map((column, depth) => (
            <div
              key={depth}
              style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 190 }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  color: "var(--ink-3)",
                }}
              >
                {depth === 0 ? t("map.entry") : t("map.hop", { n: depth })}
              </div>
              {column.map((service) => {
                const rate = errorRate.get(service) ?? 0;
                const tone = rate > 0.05 ? "var(--dang)" : rate > 0 ? "var(--wait)" : "var(--line)";
                const calls = outgoing.get(service) ?? [];
                /*
                  Picked out, not filtered to. Somebody arriving from a service
                  page wants to see where that service sits, and hiding
                  everything else would remove the only thing a map is for.
                */
                const here = service === highlight;
                return (
                  <div
                    key={service}
                    data-testid={here ? "map-node-current" : "map-node"}
                    style={{
                      border: `1px solid ${here ? "var(--brand)" : tone}`,
                      borderLeft: `3px solid ${tone}`,
                      borderRadius: 10,
                      padding: "9px 11px",
                      background: here ? "var(--brand-t)" : "var(--sunk)",
                      boxShadow: here ? "var(--shadow-card)" : "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: 5,
                    }}
                  >
                    <Link
                      href={`/app/telemetry?tab=traces&service=${encodeURIComponent(service)}`}
                      style={{ ...MONO, fontWeight: 600, color: "var(--ink)" }}
                    >
                      {service}
                    </Link>
                    <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                      {t("map.spans", {
                        count: Number(seen.find((s) => s.service_name === service)?.spans ?? 0),
                      })}
                      {rate > 0 ? ` · ${(rate * 100).toFixed(1)} %` : ""}
                    </span>
                    {calls.map((e) => (
                      <span
                        key={e.target_service}
                        style={{ fontSize: 11, color: "var(--ink-2)", lineHeight: 1.45 }}
                      >
                        → <span style={MONO}>{e.target_service}</span>
                        <span style={{ color: "var(--ink-3)" }}>
                          {" "}
                          {t("map.edge", {
                            count: Number(e.n_calls),
                            p95: e.p95_ms.toFixed(0),
                          })}
                          {Number(e.n_errors) > 0 ? (
                            <span style={{ color: "var(--dang)" }}>
                              {" "}
                              · {t("map.edgeErrors", { count: Number(e.n_errors) })}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
        {t("map.observedNote")}
      </div>
    </div>
  );
}
