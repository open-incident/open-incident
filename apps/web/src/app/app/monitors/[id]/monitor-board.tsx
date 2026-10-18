"use client";

/**
 * The live half of a monitor's page: the range bar, the charts that zoom
 * together, and the full-screen supervision view (design: V2Monitors,
 * "Monitor detail" and "Monitor — full screen").
 *
 * Everything drawn here was computed by the server from check rows; this
 * file only arranges it, keeps the crosshair and the window shared, counts
 * down to the next check, and asks the server again when that check is due.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatInstant, formatSpan, type ChartSpec } from "@openincident/ui";
import { useT } from "@/i18n/client";
import { Chart, ChartBoard, useBoard } from "../../telemetry/charts";

type Fs = { open: boolean; setOpen: (v: boolean) => void };
const FsContext = createContext<Fs | null>(null);

/** Holds whether the supervision view is open; `?fs=1` opens it on arrival. */
export function MonitorScreen({
  initialFs,
  children,
}: {
  initialFs: boolean;
  children: ReactNode;
}) {
  const [open, setOpenState] = useState(initialFs);
  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    // The address follows without a navigation, so the view is a link a
    // wall screen can be pointed at.
    const url = new URL(window.location.href);
    if (v) url.searchParams.set("fs", "1");
    else url.searchParams.delete("fs");
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);
  const value = useMemo(() => ({ open, setOpen }), [open, setOpen]);
  return <FsContext.Provider value={value}>{children}</FsContext.Provider>;
}

export function FullScreenButton({ label }: { label: string }) {
  const fs = useContext(FsContext);
  return (
    <button
      type="button"
      onClick={() => fs?.setOpen(true)}
      className="oi-hover"
      data-testid="monitor-fullscreen"
      style={{
        height: 34,
        padding: "0 13px",
        border: "1px solid var(--line)",
        borderRadius: 9,
        background: "var(--panel)",
        display: "flex",
        alignItems: "center",
        gap: 7,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        color: "inherit",
      }}
    >
      <span style={{ fontSize: 14 }}>⤢</span>
      {label}
    </button>
  );
}

export type BoardChart = { spec: ChartSpec; h: number; hint: boolean };

export type FsData = {
  name: string;
  line: string;
  state: string;
  stateLabel: string;
  tone: [string, string];
  kpis: Array<{ l: string; v: string; sub: string; ink: string }>;
  locations: Array<{ n: string; sub: string; ms: string; c: string }>;
  checks: Array<{ t: string; st: string; from: string; ms: string; ink: string }>;
  criteria: ReactNode;
  criteriaTitle: string;
  byLocation: string;
  recentChecks: string;
  nextCheckAt: number | null;
  paused: boolean;
};

const RANGE_KEYS = ["1h", "24h", "7d", "30d"];

function RangeChips({ range, height = 26 }: { range: string; height?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const board = useBoard();
  return (
    <div
      style={{ display: "flex", gap: 2, background: "var(--sunk)", borderRadius: 9, padding: 3 }}
    >
      {RANGE_KEYS.map((l) => {
        const on = l === range && !board.zoomed;
        return (
          <span
            key={l}
            role="button"
            tabIndex={0}
            data-testid={`monitor-range-${l}`}
            onClick={() => {
              const next = new URLSearchParams(params.toString());
              next.set("range", l);
              next.delete("from");
              next.delete("to");
              router.replace(`${pathname}?${next.toString()}`, { scroll: false });
            }}
            style={{
              height,
              padding: "0 10px",
              borderRadius: 7,
              background: on ? "var(--panel)" : "transparent",
              boxShadow: on ? "0 1px 2px rgba(13,22,28,.12)" : "none",
              display: "flex",
              alignItems: "center",
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              fontWeight: on ? 700 : 500,
              color: on ? "var(--ink)" : "var(--ink-3)",
              cursor: "pointer",
            }}
          >
            {l}
          </span>
        );
      })}
    </div>
  );
}

function ZoomChip({ fs }: { fs?: boolean }) {
  const t = useT();
  const board = useBoard();
  if (!board.zoomed) return null;
  const tz = { timeZone: t.timeZone, locale: "en-GB" };
  const range = `${formatInstant(board.from, 3_600_000, tz)} – ${formatInstant(board.to, 3_600_000, tz)} (${formatSpan(board.to - board.from)})`;
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={board.reset}
      data-testid="monitor-zoom-reset"
      style={{
        height: fs ? 30 : 28,
        padding: "0 10px",
        borderRadius: 8,
        background: "var(--brand-t)",
        color: "var(--brand)",
        display: "flex",
        alignItems: "center",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {fs ? t("mon2.zoomedFs", { range }) : t("mon2.zoomedChip", { range })}
    </span>
  );
}

/** The overview's charts, with the range bar above them. */
export function MonitorCharts({
  range,
  from,
  to,
  zoomed,
  charts,
  fsCharts,
  fs,
  live = true,
}: {
  range: string;
  from: number;
  to: number;
  zoomed: boolean;
  live?: boolean;
  charts: BoardChart[];
  fsCharts: BoardChart[];
  fs: FsData;
}) {
  const t = useT();
  const ctx = useContext(FsContext);
  return (
    <ChartBoard from={from} to={to} zoomed={zoomed} live={live}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <RangeChips range={range} />
        <ZoomChip />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("mon2.dragHint")}</span>
      </div>
      {charts.map((c, i) => (
        <Chart key={i} spec={c.spec} height={c.h} hint={c.hint} testId={`monitor-chart-${i}`} />
      ))}
      {ctx?.open && (
        <FullScreen range={range} charts={fsCharts} data={fs} onClose={() => ctx.setOpen(false)} />
      )}
    </ChartBoard>
  );
}

function FullScreen({
  range,
  charts,
  data,
  onClose,
}: {
  range: string;
  charts: BoardChart[];
  data: FsData;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [wide, setWide] = useState(true);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      // A chart in its own full screen handles Esc first; this one closes
      // when no chart layer is open above it.
      if (e.key === "Escape" && !document.querySelector("[data-fullscreen='true']")) onClose();
    };
    const rs = () => setWide(window.innerWidth >= 1100);
    rs();
    window.addEventListener("keydown", kd);
    window.addEventListener("resize", rs);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("resize", rs);
    };
  }, [onClose]);

  // The countdown, and a fresh read of the page each time a check is due.
  useEffect(() => {
    let refreshedAt = 0;
    const iv = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (
        !data.paused &&
        data.nextCheckAt !== null &&
        n >= data.nextCheckAt + 2000 &&
        n - refreshedAt > 10_000
      ) {
        refreshedAt = n;
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [data.nextCheckAt, data.paused, router]);

  const left =
    data.nextCheckAt === null ? null : Math.max(0, Math.ceil((data.nextCheckAt - now) / 1000));
  const live = data.paused
    ? t("mon2.fsPaused")
    : left === null || left <= 0
      ? t("mon2.fsDue")
      : t("mon2.fsLive", { n: left });

  const CARD: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: "var(--radius-card)",
    boxShadow: "var(--shadow-card)",
    overflow: "hidden",
  };

  const view = (
    <div
      data-screen-label="Monitor — full screen"
      data-testid="monitor-fs"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "var(--canvas)",
        overflow: "auto",
        animation: "oi-rise .16s ease backwards",
        fontFamily: "var(--font-ui)",
        color: "var(--ink)",
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 24px",
          background: "var(--panel)",
          borderBottom: "1px solid var(--line)",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 999,
            padding: "4px 10px",
            background: data.tone[0],
            color: data.tone[1],
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: data.tone[1],
              animation: data.paused ? "none" : "oi-pulse 2.4s infinite",
            }}
          />
          {data.stateLabel}
        </span>
        <span
          style={{
            fontFamily: "var(--title)",
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {data.name}
        </span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-3)" }}>
          {data.line}
        </span>
        <span style={{ flex: 1 }} />
        <span
          data-testid="monitor-fs-live"
          style={{
            fontSize: 11.5,
            color: data.paused ? "var(--ink-3)" : "var(--ok)",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: data.paused ? "var(--ink-3)" : "var(--ok)",
              animation: data.paused ? "none" : "oi-pulse 2s infinite",
            }}
          />
          {live}
        </span>
        <RangeChips range={range} />
        <ZoomChip fs />
        <span
          role="button"
          tabIndex={0}
          onClick={onClose}
          data-testid="monitor-fs-exit"
          style={{
            height: 32,
            padding: "0 12px",
            borderRadius: 9,
            background: "var(--topbar-dark)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          ✕ {t("mon2.fsExit")}{" "}
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, opacity: 0.6 }}>Esc</span>
        </span>
      </div>
      <div style={{ padding: "18px 24px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          data-testid="monitor-fs-kpis"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${wide ? 6 : 3},minmax(0,1fr))`,
            gap: 1,
            background: "var(--line)",
            border: "1px solid var(--line)",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          {data.kpis.map((k) => (
            <div key={k.l} style={{ background: "var(--panel)", padding: "14px 18px" }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  color: "var(--ink-3)",
                }}
              >
                {k.l}
              </div>
              <div
                style={{
                  fontFamily: "var(--title)",
                  fontSize: 28,
                  fontWeight: 600,
                  marginTop: 3,
                  color: k.ink,
                  letterSpacing: "-.01em",
                }}
              >
                {k.v}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{k.sub}</div>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 320px",
            gap: 14,
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            {charts.map((c, i) => (
              <Chart key={i} spec={c.spec} height={c.h} hint={c.hint} />
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={CARD}>
              <div style={{ padding: "12px 16px", fontSize: 13.5, fontWeight: 600 }}>
                {data.byLocation}
              </div>
              {data.locations.map((g) => (
                <div
                  key={g.n}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 16px",
                    borderTop: "1px solid var(--line-2)",
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.c }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{g.n}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{g.sub}</div>
                  </div>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 600 }}>
                    {g.ms}
                  </span>
                </div>
              ))}
            </div>
            <div style={CARD}>
              <div style={{ padding: "12px 16px", fontSize: 13.5, fontWeight: 600 }}>
                {data.recentChecks}
              </div>
              {data.checks.map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "52px minmax(0,1fr) 64px",
                    gap: 10,
                    padding: "8px 16px",
                    borderTop: "1px solid var(--line-2)",
                    fontSize: 12,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontFamily: "var(--mono)", color: "var(--ink-3)" }}>{c.t}</span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontWeight: 600,
                      color: c.ink,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: c.ink,
                        flex: "none",
                      }}
                    />
                    {c.st} · {c.from}
                  </span>
                  <span style={{ fontFamily: "var(--mono)", textAlign: "right" }}>{c.ms}</span>
                </div>
              ))}
            </div>
            <div
              style={{
                ...CARD,
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  color: "var(--ink-3)",
                }}
              >
                {data.criteriaTitle}
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>{data.criteria}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? view : createPortal(view, document.body);
}

/** For the server: the instants of a window as the zoom chip writes them. */
export function windowLabel(from: number, to: number, timeZone: string): string {
  return `${formatInstant(from, 3_600_000, { timeZone })} – ${formatInstant(to, 3_600_000, { timeZone })}`;
}
