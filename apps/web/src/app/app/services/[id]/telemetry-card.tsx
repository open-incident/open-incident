import Link from "next/link";
import { getT } from "@/i18n/server";
import { serviceWindow, telemetryInstalled } from "@/lib/telemetry";
import type { MessageKey } from "@/i18n/dictionaries/en";
import { CARD, EYEBROW } from "./ui";

const HOURS = 24;

/**
 * This service's own signals — rate, errors, duration — and the way into each.
 *
 * Four numbers and three links rather than three embedded explorers: the
 * explorers already filter by service, and what this card adds is "is
 * anything wrong right now", which is a glance, not a console. Every figure is
 * set against the same window the day before; a count on its own is
 * unreadable. Read under every name the service goes by.
 *
 * Nothing is drawn when the traces have never named the service: an empty
 * card of zeros would read as a quiet service, not as an unwatched one.
 */
export async function ServiceTelemetry({ tenantId, names }: { tenantId: string; names: string[] }) {
  const t = await getT();
  if (!telemetryInstalled()) return null;

  const to = new Date();
  const from = new Date(to.getTime() - HOURS * 3_600_000);
  const windows = await Promise.all(
    names.map((n) => serviceWindow(tenantId, n, from, to).catch(() => null)),
  );
  type Totals = {
    spans: number;
    spansBefore: number;
    errorSpans: number;
    errorSpansBefore: number;
    errorLogs: number;
    errorLogsBefore: number;
    p95Ms: number;
    p95MsBefore: number;
  };
  const w = windows.reduce<Totals>(
    (acc, x) =>
      x
        ? {
            spans: acc.spans + x.spans,
            spansBefore: acc.spansBefore + x.spansBefore,
            errorSpans: acc.errorSpans + x.errorSpans,
            errorSpansBefore: acc.errorSpansBefore + x.errorSpansBefore,
            errorLogs: acc.errorLogs + x.errorLogs,
            errorLogsBefore: acc.errorLogsBefore + x.errorLogsBefore,
            p95Ms: Math.max(acc.p95Ms, x.p95Ms),
            p95MsBefore: Math.max(acc.p95MsBefore, x.p95MsBefore),
          }
        : acc,
    {
      spans: 0,
      spansBefore: 0,
      errorSpans: 0,
      errorSpansBefore: 0,
      errorLogs: 0,
      errorLogsBefore: 0,
      p95Ms: 0,
      p95MsBefore: 0,
    },
  );
  if (w.spans === 0 && w.errorLogs === 0 && w.spansBefore === 0 && w.errorLogsBefore === 0) {
    return null;
  }

  const rate = w.spans > 0 ? (w.errorSpans / w.spans) * 100 : 0;
  const rateBefore = w.spansBefore > 0 ? (w.errorSpansBefore / w.spansBefore) * 100 : 0;
  const q = `service=${encodeURIComponent(names[0]!)}`;

  const figures: Array<{ label: MessageKey; value: string; was: string; ink: string }> = [
    {
      label: "svcTelemetry.spans",
      value: t.fmt.number(w.spans),
      was: t.fmt.number(w.spansBefore),
      ink: "var(--ink)",
    },
    {
      label: "svcTelemetry.errorRate",
      value: `${t.fmt.number(Math.round(rate * 10) / 10)} %`,
      was: `${t.fmt.number(Math.round(rateBefore * 10) / 10)} %`,
      ink: rate > rateBefore && rate > 1 ? "var(--dang)" : "var(--ink)",
    },
    {
      label: "svcTelemetry.p95",
      value: `${t.fmt.number(Math.round(w.p95Ms))} ms`,
      was: `${t.fmt.number(Math.round(w.p95MsBefore))} ms`,
      ink: w.p95Ms > w.p95MsBefore * 1.5 && w.p95MsBefore > 0 ? "var(--wait)" : "var(--ink)",
    },
    {
      label: "svcTelemetry.errorLogs",
      value: t.fmt.number(w.errorLogs),
      was: t.fmt.number(w.errorLogsBefore),
      ink: w.errorLogs > w.errorLogsBefore ? "var(--dang)" : "var(--ink)",
    },
  ];

  return (
    <div style={{ ...CARD, gap: 10 }} data-testid="service-telemetry">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("svcTelemetry.title")}</span>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
          {t("svcTelemetry.windowShort", { hours: HOURS })}
        </span>
        <span style={{ flex: 1 }} />
        {(
          [
            ["traces", "telemetry.tab.traces"],
            ["logs", "telemetry.tab.logs"],
            ["exceptions", "telemetry.tab.exceptions"],
          ] as const
        ).map(([tab, label]) => (
          <Link
            key={tab}
            href={`/app/telemetry?tab=${tab}&${q}`}
            style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}
          >
            {t(label)} →
          </Link>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {figures.map((f) => (
          <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={EYEBROW}>{t(f.label)}</span>
            <span
              style={{ fontFamily: "var(--title)", fontSize: 19, fontWeight: 600, color: f.ink }}
            >
              {f.value}
            </span>
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
              {t("svcTelemetry.was", { value: f.was })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
