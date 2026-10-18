import Link from "next/link";
import { getT } from "@/i18n/server";
import { trace as spansOf, traces as listTraces } from "@/lib/telemetry";
import {
  atlasOnTrace,
  openIncidents,
  traceCount,
  type TelemetrySearch,
} from "@/lib/telemetry-board";
import { axisTicks, formatMs, timeByService, traceStory, traceTree } from "./trace-model";
import { TraceFilters } from "./trace-filters";
import { TraceWaterfall, type WaterfallSpan } from "./trace-waterfall";

/**
 * Telemetry — Traces (designs: "Telemetry — Traces", "Trace waterfall",
 * "Span detail", "Trace — sequence").
 *
 * The filter chips, the matching traces newest first, and the selected trace
 * opened below: its waterfall with the critical path, the selected span's
 * detail, what happened in order (read from the spans, no model involved),
 * and where its time went by service.
 */

/** A palette shared by the list and the waterfall: the same service, the same colour. */
const PALETTE = [
  "var(--brand)",
  "var(--brand-2)",
  "var(--wait)",
  "var(--ok)",
  "var(--viol)",
  "#0891b2",
  "#be185d",
  "#a16207",
];

export async function TracesView({
  tenantId,
  from,
  to,
  sp,
  mayEdit,
}: {
  tenantId: string;
  from: Date;
  to: Date;
  sp: TelemetrySearch;
  mayEdit: boolean;
}) {
  const t = await getT();
  const minSeconds = Number(sp.min);
  const conditions = [
    ...(sp.status === "error" ? ["status_code = 'error'"] : []),
    ...(Number.isFinite(minSeconds) && minSeconds > 0
      ? [`duration_ms > ${Math.round(minSeconds * 1000)}`]
      : []),
  ];
  const filter = conditions.join(" AND ") || undefined;
  const [page, count, open] = await Promise.all([
    listTraces(tenantId, { from, to, service: sp.service, filter, limit: 12 }),
    traceCount(tenantId, { from, to, service: sp.service, filter }),
    openIncidents(tenantId),
  ]);
  const selectedId = sp.trace ?? page.rows[0]?.trace_id ?? null;
  const spans = selectedId ? await spansOf(tenantId, selectedId) : [];
  const nodes = traceTree(spans);
  const atlas = selectedId && nodes.length ? await atlasOnTrace(tenantId, selectedId) : null;

  // One colour per service across the list and the waterfall.
  const names = [
    ...new Set([...nodes.map((n) => n.span.service_name), ...page.rows.flatMap((r) => r.services)]),
  ];
  const colour = new Map(names.map((n, i) => [n, PALETTE[i % PALETTE.length]!]));

  const base = (over: Record<string, string | null>) => {
    const q = new URLSearchParams();
    q.set("tab", "traces");
    for (const [k, v] of Object.entries({
      range: sp.range ?? null,
      from: sp.from ?? null,
      to: sp.to ?? null,
      service: sp.service ?? null,
      status: sp.status ?? null,
      min: sp.min ?? null,
      ...over,
    }))
      if (v) q.set(k, v);
    return `/app/telemetry?${q.toString()}`;
  };

  const total = nodes.length ? Math.max(...nodes.map((n) => n.startMs + n.durationMs)) : 0;
  const root = nodes[0];
  const rootStatus =
    root?.span.http_status_code || (root?.span.status_code === "error" ? 500 : 200);
  const services = [...new Set(nodes.map((n) => n.span.service_name))];
  const relevant =
    open.find(
      (i) =>
        services.includes(i.service) &&
        nodes.some((n) => n.span.service_name === i.service && n.span.status_code === "error"),
    ) ??
    open.find((i) => services.includes(i.service)) ??
    null;
  const waterfall: WaterfallSpan[] = nodes.map((n) => ({
    id: n.span.span_id,
    depth: n.depth,
    service: n.span.service_name,
    op: n.span.name,
    kind: n.span.kind,
    start: n.startMs,
    duration: n.durationMs,
    self: n.selfMs,
    critical: n.critical,
    error: n.span.status_code === "error",
    errorMessage: n.span.status_message,
    colour: colour.get(n.span.service_name) ?? PALETTE[0]!,
    events: (n.span.events ?? []).map((e) => {
      const at =
        Date.parse(`${e.ts.replace(" ", "T")}Z`) -
        Date.parse(`${n.span.start_ts.replace(" ", "T")}Z`);
      const isErr = e.name === "exception" || /fail|timeout|error/i.test(e.name);
      return {
        at: n.startMs + (Number.isFinite(at) ? Math.max(0, at) : 0),
        name:
          e.name === "exception"
            ? `exception ${e.attributes["exception.type"] ?? ""}`.trim()
            : e.name,
        tone: isErr
          ? ("dang" as const)
          : /wait|queue/i.test(e.name)
            ? ("wait" as const)
            : ("ink" as const),
      };
    }),
    attrs: Object.entries(n.span.attributes ?? {}).slice(0, 10),
  }));
  // The span opened first: where the failure started, else where the time went.
  const firstError = [...nodes].reverse().find((n) => n.span.status_code === "error" && n.critical);
  const heaviest = [...nodes].sort((a, b) => b.selfMs - a.selfMs)[0];
  const initial = sp.span ?? firstError?.span.span_id ?? heaviest?.span.span_id ?? null;

  const story = traceStory(nodes, 8);
  const byService = timeByService(nodes);
  const maxService = Math.max(1, ...byService.map((b) => b.ms));

  return (
    <div
      data-screen-label="Telemetry — Traces"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        animation: "oi-rise .16s ease backwards",
      }}
    >
      <TraceFilters
        service={sp.service ?? null}
        status={sp.status ?? null}
        min={Number.isFinite(minSeconds) && minSeconds > 0 ? minSeconds : null}
        services={names}
        countLine={
          count.sampled < 0.999
            ? t("tel2.tracesCountSampled", {
                count: t.fmt.number(count.traces),
                pct: Math.round(count.sampled * 100),
              })
            : t("tel2.tracesCount", { count: t.fmt.number(count.traces) })
        }
      />

      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
          overflowX: "auto",
        }}
        data-testid="trace-list"
      >
        {page.rows.length === 0 && (
          <div style={{ padding: 16, fontSize: 13, color: "var(--ink-2)" }}>
            {t("tel2.noTraces")}
          </div>
        )}
        {page.rows.map((r) => {
          const on = r.trace_id === selectedId;
          const code = r.root_status || (Number(r.error_count) > 0 ? 500 : 200);
          const ok = code < 400;
          const d = Number(r.duration_ns) / 1e6;
          return (
            <Link
              key={r.trace_id}
              href={base({ trace: r.trace_id })}
              scroll={false}
              className="oi-hover"
              data-testid="trace-row"
              style={{
                display: "grid",
                gridTemplateColumns: "70px 44px minmax(160px,1fr) 90px 70px 64px",
                gap: 10,
                minWidth: 560,
                alignItems: "center",
                padding: "9px 16px",
                borderBottom: "1px solid var(--line-2)",
                cursor: "pointer",
                background: on ? "var(--brand-t)" : "transparent",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-3)" }}>
                {t.fmt.time(new Date(`${r.start_ts.replace(" ", "T")}Z`), t.timeZone)}
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  borderRadius: 5,
                  padding: "2px 0",
                  textAlign: "center",
                  background: ok ? "var(--ok-t)" : "var(--dang-t)",
                  color: ok ? "var(--ok)" : "var(--dang)",
                }}
              >
                {code}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.root_name}
              </span>
              <span style={{ display: "flex", gap: 3 }} title={r.services.join(" · ")}>
                {r.services.slice(0, 6).map((s) => (
                  <span
                    key={s}
                    style={{ width: 10, height: 10, borderRadius: 3, background: colour.get(s) }}
                  />
                ))}
              </span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: d > 3000 ? "var(--dang)" : "var(--ink)",
                  textAlign: "right",
                }}
              >
                {formatMs(d)}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)", textAlign: "right" }}>
                {t("tel2.spans", { count: Number(r.span_count) })}
              </span>
            </Link>
          );
        })}
      </div>

      {root && (
        <TraceWaterfall
          traceId={selectedId!}
          title={root.span.name}
          status={rootStatus}
          startLabel={`${selectedId!.slice(0, 8)} · ${new Date(
            `${root.span.start_ts.replace(" ", "T")}Z`,
          ).toLocaleTimeString("en-GB", {
            hour12: false,
            timeZone: t.timeZone,
            fractionalSecondDigits: 3,
          })}`}
          legend={services.map((s) => ({ n: s, c: colour.get(s)! }))}
          spans={waterfall}
          total={total}
          ticks={axisTicks(total, 4)}
          initialSpan={initial}
          initialCritical={sp.crit !== "0"}
          attach={
            mayEdit && relevant ? { incidentId: relevant.id, ref: `INC-${relevant.number}` } : null
          }
          attached={sp.attached ?? null}
        />
      )}

      {root && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
            gap: 12,
            alignItems: "start",
          }}
        >
          <div
            data-screen-label="Trace — sequence"
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-card)",
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t("tel2.sequence")}</span>
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{t("tel2.sequenceSub")}</span>
            </div>
            {story.map((q, i) => {
              const tone =
                q.kind === "error"
                  ? ["var(--dang-t)", "var(--dang)"]
                  : q.kind === "slow"
                    ? ["var(--wait-t)", "var(--wait)"]
                    : ["var(--sunk)", "var(--ink-2)"];
              return (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "22px 58px minmax(0,1fr)",
                    gap: 8,
                    alignItems: "baseline",
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: tone[0],
                      color: tone[1],
                      display: "grid",
                      placeItems: "center",
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
                    +{formatMs(q.atMs)}
                  </span>
                  <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                    {t(`tel2.story.${q.kind}` as "tel2.story.start", {
                      service: q.service,
                      text: q.text,
                      dur: formatMs(
                        nodes.find(
                          (n) => n.span.name === q.text && n.span.service_name === q.service,
                        )?.selfMs ?? 0,
                      ),
                    })}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {atlas && (
              <div
                data-testid="trace-atlas"
                style={{
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-card)",
                  boxShadow: "var(--shadow-card)",
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    color: "var(--viol)",
                  }}
                >
                  ✦ {t("tel2.atlasTrace")}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>{atlas.statement}</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {atlas.sources.map((s) => (
                    <span
                      key={s}
                      style={{
                        fontSize: 10.5,
                        border: "1px solid var(--line)",
                        borderRadius: 6,
                        padding: "2px 7px",
                        color: "var(--ink-3)",
                      }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div
              style={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-card)",
                boxShadow: "var(--shadow-card)",
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
              data-testid="trace-by-service"
            >
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  color: "var(--ink-3)",
                }}
              >
                {t("tel2.byService")}
              </div>
              {byService.map((b) => (
                <div
                  key={b.service}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
                >
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 3,
                      background: colour.get(b.service),
                    }}
                  />
                  <span style={{ width: 120, fontFamily: "var(--mono)", fontSize: 11.5 }}>
                    {b.service}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 8,
                      borderRadius: 999,
                      background: "var(--sunk)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        background: colour.get(b.service),
                        width: `${Math.round((b.ms / maxService) * 100)}%`,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      width: 56,
                      textAlign: "right",
                    }}
                  >
                    {formatMs(b.ms)}
                  </span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{t("tel2.selfTime")}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
