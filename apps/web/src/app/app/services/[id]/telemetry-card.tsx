import Link from "next/link";
import { getT } from "@/i18n/server";
import { serviceWindow, telemetryInstalled } from "@/lib/telemetry";
import type { MessageKey } from "@/i18n/dictionaries/en";

const HOURS = 24;

/**
 * This service's own signals, and the way into each of them.
 *
 * Four numbers and four links rather than four embedded explorers. The
 * explorers already exist, they already filter by service, and copying them
 * here would be two screens to keep in step for no new answer — what this card
 * adds is "is anything wrong right now", which is a glance, not a console.
 *
 * Every figure is against the same window the day before. A count on its own
 * is unreadable: nobody knows whether four hundred error logs is a bad day or
 * a normal one for this particular service.
 */
export async function ServiceTelemetry({
  tenantId,
  service,
}: {
  tenantId: string;
  service: string;
}) {
  const t = await getT();
  if (!telemetryInstalled()) return null;

  const to = new Date();
  const from = new Date(to.getTime() - HOURS * 3_600_000);
  const w = await serviceWindow(tenantId, service, from, to);
  if (w.spans === 0 && w.errorLogs === 0 && w.spansBefore === 0 && w.errorLogsBefore === 0) {
    return null;
  }

  const rate = w.spans > 0 ? (w.errorSpans / w.spans) * 100 : 0;
  const rateBefore = w.spansBefore > 0 ? (w.errorSpansBefore / w.spansBefore) * 100 : 0;
  const q = `service=${encodeURIComponent(service)}`;

  const figures: Array<{ label: MessageKey; value: string; was: string; ink: string }> = [
    {
      label: "svcTelemetry.errorLogs",
      value: String(w.errorLogs),
      was: String(w.errorLogsBefore),
      ink: w.errorLogs > w.errorLogsBefore ? "var(--dang)" : "var(--ink)",
    },
    {
      label: "svcTelemetry.spans",
      value: String(w.spans),
      was: String(w.spansBefore),
      ink: "var(--ink)",
    },
    {
      label: "svcTelemetry.errorRate",
      value: `${rate.toFixed(1)} %`,
      was: `${rateBefore.toFixed(1)} %`,
      ink: rate > rateBefore ? "var(--dang)" : "var(--ink)",
    },
    {
      label: "svcTelemetry.p95",
      value: `${w.p95Ms} ms`,
      was: `${w.p95MsBefore} ms`,
      ink: w.p95Ms > w.p95MsBefore * 1.5 ? "var(--wait)" : "var(--ink)",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        {figures.map((f) => (
          <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-3)" }}>
              {t(f.label)}
            </span>
            <span style={{ fontSize: 17, fontWeight: 600, color: f.ink }}>{f.value}</span>
            <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
              {t("svcTelemetry.was", { value: f.was })}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {(
          [
            ["logs", "telemetry.tab.logs"],
            ["traces", "telemetry.tab.traces"],
            ["exceptions", "telemetry.tab.exceptions"],
          ] as const
        ).map(([tab, label]) => (
          <Link
            key={tab}
            href={`/app/telemetry?tab=${tab}&${q}`}
            style={{ fontSize: 11.5, color: "var(--brand)", textDecoration: "none" }}
          >
            {t(label)} →
          </Link>
        ))}
      </div>
      <span style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.45 }}>
        {t("svcTelemetry.window", { hours: HOURS })}
      </span>
    </div>
  );
}
