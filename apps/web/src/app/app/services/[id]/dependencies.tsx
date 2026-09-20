import Link from "next/link";
import { getT } from "@/i18n/server";
import { neighbours, telemetryInstalled } from "@/lib/telemetry";

const MONO: React.CSSProperties = { fontFamily: "var(--mono)", fontSize: 11.5 };

/** The window this card looks at. A day: long enough to include the night shift. */
const HOURS = 24;

/**
 * What this service talks to, observed rather than declared.
 *
 * The card used to say "nothing observed yet" whatever was true, because there
 * was nothing to read. There is now — the service map's edges — and the
 * sentence it shows when there is nothing has to keep meaning what it says, so
 * the three empty cases are distinguished: no column store at all, a column
 * store with no traces from this service, and traces that never crossed to
 * another service.
 *
 * Upstream and downstream are separated on purpose. During an incident, what
 * this service calls is where to look for a cause; what calls it is who is
 * about to notice.
 */
export async function Dependencies({ tenantId, service }: { tenantId: string; service: string }) {
  const t = await getT();
  if (!telemetryInstalled()) {
    return (
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
        {t("services.dependenciesNoTelemetry")}
      </div>
    );
  }

  const to = new Date();
  const from = new Date(to.getTime() - HOURS * 3_600_000);
  const rows = await neighbours(tenantId, service, from, to);
  if (rows.length === 0) {
    return (
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
        {t("services.dependenciesEmpty")}
      </div>
    );
  }

  const groups = [
    { direction: "downstream" as const, label: t("services.calls") },
    { direction: "upstream" as const, label: t("services.calledBy") },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {groups.map(({ direction, label }) => {
        const mine = rows.filter((r) => r.direction === direction);
        if (mine.length === 0) return null;
        return (
          <div key={direction} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)" }}>{label}</span>
            {mine.map((n) => {
              const rate = n.calls > 0 ? (n.errors / n.calls) * 100 : 0;
              return (
                <div
                  key={n.other}
                  data-testid="service-dependency"
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    fontSize: 12.5,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ ...MONO, fontSize: 12.5, fontWeight: 600 }}>{n.other}</span>
                  <span
                    style={{ color: rate > 5 ? "var(--dang)" : "var(--ink-3)", fontSize: 11.5 }}
                  >
                    {t("services.depEdge", {
                      count: n.calls,
                      p95: n.p95Ms.toFixed(0),
                      rate: rate.toFixed(1),
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
      <Link
        href="/app/telemetry?tab=map"
        style={{ fontSize: 11.5, color: "var(--brand)", textDecoration: "none" }}
      >
        {t("services.seeMap")}
      </Link>
      <span style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.45 }}>
        {t("services.depObserved", { hours: HOURS })}
      </span>
    </div>
  );
}
