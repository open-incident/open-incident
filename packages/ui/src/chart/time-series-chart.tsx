"use client";

/**
 * TimeSeriesChart — the one chart of the product (design: `V2Chart`).
 *
 * Every number on it is the caller's: the chart draws the points it is given,
 * on the window it is given, and never invents a value between two of them.
 * A gap in a series (a `null`) is a hole in the line, not a zero — a service
 * that went quiet is not a service whose latency collapsed.
 *
 * What it does on its own:
 *  - crosshair and tooltip, at the point nearest the pointer in every series,
 *    with a note when the moment is a marker (a deploy, a declaration) or the
 *    first series is above the threshold;
 *  - drag to select a window, double-click to come back — the caller decides
 *    what a zoom means (it re-queries at a finer resolution), the chart only
 *    keeps a local window when nobody is listening;
 *  - a click on a legend entry hides or shows that series;
 *  - full screen, with Min / Avg / p95 / Max / Last per series and Esc to
 *    leave.
 *
 * Synchronised hover: pass the same `hoverT` and `onHover` to every chart of a
 * page and they move together.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatInstant, formatStep, formatValue, niceCeiling, type ChartUnit } from "./format";

/** One point: an instant in epoch milliseconds, and a value or a hole. */
export type ChartPoint = [number, number | null];

export type ChartSeries = {
  /** Name, shown in the legend and the tooltip. */
  n: string;
  /** Any CSS colour — the tokens (`var(--brand)`) in practice. */
  c: string;
  points: ChartPoint[];
  dash?: boolean;
  /** Force the area under this series on (true) or off (false). */
  fill?: boolean;
};

/** A vertical marker: a deploy, a declaration. */
export type ChartMark = { t: number; l: string; c?: string; bg?: string; href?: string };

/** A shaded span: an incident that was open. `b` may be in the future (still open). */
export type ChartBand = { a: number; b: number; l: string; bg?: string; ink?: string };

export type ChartSpec = {
  title: string;
  sub?: string;
  unit?: ChartUnit;
  series: ChartSeries[];
  threshold?: { v: number; l: string } | null;
  marks?: ChartMark[];
  bands?: ChartBand[];
  kind?: "line" | "area";
  /** A fixed top of the y axis. */
  max?: number;
  /** The big figure goes red regardless of the threshold. */
  hot?: boolean;
  /** The first series, 24 hours earlier, already moved onto this window's axis. */
  compare?: ChartPoint[];
  /** The bucket width the points were computed at, for "resolution …". */
  stepMs?: number;
  /** Said in the plot when no series has a single point. */
  empty?: string;
};

export type ChartLabels = {
  resetZoom: string;
  fullScreen: string;
  exitFullScreen: string;
  now: string;
  hidden: string;
  hint: string;
  fsDrag: string;
  fsLegend: string;
  fsEsc: string;
  /** `{range}` is replaced. */
  seriesHead: string;
  min: string;
  avg: string;
  p95: string;
  max: string;
  last: string;
  /** `{step}` is replaced. */
  resolution: string;
  /** `{label}` is replaced. */
  aboveThreshold: string;
  /** `{name}` is replaced. */
  dayAgo: string;
  noData: string;
};

export const DEFAULT_CHART_LABELS: ChartLabels = {
  resetZoom: "↺ Reset zoom",
  fullScreen: "Full screen",
  exitFullScreen: "Exit full screen (Esc)",
  now: "now",
  hidden: "hidden",
  hint: "Drag across the chart to zoom · double-click to reset",
  fsDrag: "Drag to zoom · double-click to reset",
  fsLegend: "Click a series to hide it",
  fsEsc: "Esc to exit full screen",
  seriesHead: "Series · {range}",
  min: "Min",
  avg: "Avg",
  p95: "p95",
  max: "Max",
  last: "Last",
  resolution: "resolution {step}",
  aboveThreshold: "Above threshold · {label}",
  dayAgo: "{name} · 24 h ago",
  noData: "No data in this window",
};

export type TimeSeriesChartProps = {
  spec: ChartSpec;
  /** The window, epoch milliseconds. */
  from: number;
  to: number;
  height?: number;
  /** Shared crosshair: the instant under the pointer on any chart of the page. */
  hoverT?: number | null;
  onHover?: (t: number | null) => void;
  /** A window was dragged out. Without a listener the chart zooms on its own. */
  onZoom?: (from: number, to: number) => void;
  onReset?: () => void;
  /** The page is zoomed (shows "Reset zoom", and the right end stops saying "now"). */
  zoomed?: boolean;
  /** Draw `spec.compare` as the dashed "24 h ago" series. */
  compare?: boolean;
  /** The right end of the axis is the present ("now"). */
  liveEnd?: boolean;
  /** The drag hint under the axis. */
  hint?: boolean;
  tooltip?: boolean;
  labels?: Partial<ChartLabels>;
  locale?: string;
  timeZone?: string;
  /**
   * Where the full-screen layer is mounted. The app passes a portal to
   * `document.body`, so no transformed ancestor can trap a `position: fixed`;
   * without one the layer renders in place, as the design does.
   */
  portal?: (node: ReactNode) => ReactNode;
  /** Stable hook for tests. */
  testId?: string;
};

type Shown = ChartSeries & { i: number; on: boolean; cmp?: boolean };

const fill = (s: string, key: string, value: string) => s.replace(`{${key}}`, value);

/** Index of the point nearest `t`, among points sorted by time. */
function nearest(points: ChartPoint[], t: number): number {
  if (points.length === 0) return -1;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]![0] < t) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo]![0] - t) <= Math.abs(points[hi]![0] - t) ? lo : hi;
}

/** The last point that has a value. */
function lastValue(points: ChartPoint[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const v = points[i]![1];
    if (v != null && !Number.isNaN(v)) return v;
  }
  return null;
}

/** The step of a series when the caller did not say: the smallest gap between two points. */
function inferStep(series: ChartSeries[]): number {
  let step = Infinity;
  for (const s of series) {
    for (let i = 1; i < s.points.length; i++) {
      const d = s.points[i]![0] - s.points[i - 1]![0];
      if (d > 0 && d < step) step = d;
    }
  }
  return Number.isFinite(step) ? step : 60_000;
}

export function TimeSeriesChart(props: TimeSeriesChartProps) {
  const {
    spec,
    height = 150,
    hint = true,
    tooltip = true,
    liveEnd = true,
    locale,
    timeZone,
  } = props;
  const L = useMemo(() => ({ ...DEFAULT_CHART_LABELS, ...(props.labels ?? {}) }), [props.labels]);
  const u = spec.unit;

  const [fs, setFs] = useState(false);
  const [hov, setHov] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const [zw, setZw] = useState<[number, number] | null>(null);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [ph, setPh] = useState(0);
  const [vh, setVh] = useState(900);

  const outerRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const unbindRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!fs) return;
    const kd = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFs(false);
    };
    const rs = () => setVh(window.innerHeight);
    rs();
    window.addEventListener("keydown", kd);
    window.addEventListener("resize", rs);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("resize", rs);
    };
  }, [fs]);
  useEffect(() => () => unbindRef.current?.(), []);

  const [from, to] = zw ?? [props.from, props.to];
  const span = Math.max(1, to - from);

  const frac = useCallback((clientX: number) => {
    const r = plotRef.current?.getBoundingClientRect();
    if (!r || !r.width) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  }, []);

  // The series, the comparison appended, each cut to the window.
  const all: Shown[] = useMemo(() => {
    const list: Shown[] = spec.series.map((s, i) => ({ ...s, i, on: !hidden[s.n] }));
    if (props.compare && spec.compare && spec.series[0]) {
      const name = fill(L.dayAgo, "name", spec.series[0].n);
      list.push({
        n: name,
        c: "var(--ink-3)",
        dash: true,
        fill: false,
        points: spec.compare,
        i: list.length,
        on: !hidden[name],
        cmp: true,
      });
    }
    return list.map((s) => ({
      ...s,
      points: s.points.filter(([t]) => t >= from && t <= to),
    }));
  }, [spec.series, spec.compare, props.compare, hidden, from, to, L.dayAgo]);
  const shown = all.filter((s) => s.on);
  const stepMs = spec.stepMs ?? inferStep(spec.series);

  let mx = 0;
  for (const s of shown) for (const [, v] of s.points) if (v != null && v > mx) mx = v;
  const thr = spec.threshold ?? null;
  if (thr && thr.v * 1.15 > mx && thr.v < mx * 3) mx = thr.v * 1.15;
  mx = spec.max ?? niceCeiling(mx * 1.08);
  const Y = (v: number) => 1000 - Math.min(1, Math.max(0, v / mx)) * 1000;
  const X = (t: number) => ((t - from) / span) * 1000;
  const F = (t: number) => (t - from) / span;
  const pct = (f: number) => (f * 100).toFixed(3) + "%";
  const hasData = shown.some((s) => s.points.some(([, v]) => v != null));

  // The paths: one per run of consecutive values, so a hole stays a hole.
  const paths: ReactNode[] = [];
  for (const x of shown) {
    const runs: ChartPoint[][] = [];
    let run: ChartPoint[] = [];
    for (const p of x.points) {
      if (p[1] == null || Number.isNaN(p[1])) {
        if (run.length) runs.push(run);
        run = [];
      } else run.push(p);
    }
    if (run.length) runs.push(run);
    runs.forEach((r, k) => {
      const pts = r.map(([t, v]) => `${X(t).toFixed(1)},${Y(v!).toFixed(1)}`);
      // A lone point still deserves a mark: a 1-unit stub the stroke can draw.
      const line =
        r.length === 1
          ? `M${pts[0]} L${(X(r[0]![0]) + 2).toFixed(1)},${Y(r[0]![1]!).toFixed(1)}`
          : "M" + pts.join(" L");
      const first = X(r[0]![0]).toFixed(1);
      const last = X(r[r.length - 1]![0]).toFixed(1);
      if (x.fill !== false && (spec.kind === "area" || x.fill)) {
        paths.push(
          <path
            key={`${x.n}a${k}`}
            d={`${line} L${last},1000 L${first},1000 Z`}
            style={{ fill: x.c, opacity: x.i === 0 ? 0.12 : 0.07, stroke: "none" }}
          />,
        );
      }
      paths.push(
        <path
          key={`${x.n}${k}`}
          d={line}
          vectorEffect="non-scaling-stroke"
          style={{
            fill: "none",
            stroke: x.c,
            strokeWidth: x.i === 0 ? 1.8 : 1.4,
            strokeDasharray: x.dash ? "4 3" : "none",
            strokeLinejoin: "round",
          }}
        />,
      );
    });
  }
  if (thr) {
    paths.push(
      <line
        key="thr"
        x1={0}
        x2={1000}
        y1={Y(thr.v)}
        y2={Y(thr.v)}
        vectorEffect="non-scaling-stroke"
        style={{ stroke: "var(--wait)", strokeWidth: 1.2, strokeDasharray: "5 4" }}
      />,
    );
  }

  const marks = (spec.marks ?? [])
    .filter((m) => m.t >= from && m.t <= to)
    .map((m) => {
      const f = F(m.t);
      return {
        key: `${m.t}-${m.l}`,
        l: pct(f),
        c: m.c ?? "var(--viol)",
        bg: m.bg ?? "var(--viol-t)",
        label: m.l,
        tx: f > 0.75 ? "translateX(calc(-100% - 4px))" : "translateX(4px)",
      };
    });
  const bands = (spec.bands ?? [])
    .filter((b) => b.b > from && b.a < to)
    .map((b) => {
      const a = Math.max(0, F(b.a));
      const z = Math.min(1, F(b.b));
      return {
        key: `${b.a}-${b.l}`,
        l: pct(a),
        w: pct(z - a),
        bg: b.bg ?? "rgba(192,52,43,.06)",
        ink: b.ink ?? "var(--dang)",
        label: z - a > 0.12 ? b.l : "",
      };
    });

  const controlled = props.onHover !== undefined;
  const hT = controlled ? (props.hoverT ?? null) : hov;
  const hovering = hT != null && hT >= from && hT <= to && !drag && hasData;
  const first = shown[0];
  // The crosshair snaps to the first series' nearest point, as the design
  // snaps to its nearest sample.
  const snapT = (() => {
    if (!hovering) return null;
    const ref = shown.find((s) => s.points.length > 0);
    if (!ref) return hT;
    const i = nearest(ref.points, hT!);
    return i >= 0 ? ref.points[i]![0] : hT;
  })();
  const valueAt = (s: Shown): number | null => {
    if (!hovering) return lastValue(s.points);
    const i = nearest(s.points, snapT!);
    if (i < 0) return null;
    // Farther than one and a half steps is somebody else's moment.
    if (Math.abs(s.points[i]![0] - snapT!) > stepMs * 1.5) return null;
    return s.points[i]![1];
  };
  const firstVal = first ? valueAt(first) : null;
  const thrHit = !!thr && firstVal != null && firstVal > thr.v;
  const mk = hovering
    ? (spec.marks ?? []).find((m) => Math.abs(m.t - hT!) <= span / 40)
    : undefined;
  const hf = hovering ? F(snapT!) : 0;

  const tl = (t: number) => formatInstant(t, span, { locale, timeZone });
  const zoomed = !!zw || !!props.zoomed;
  const yt = [0, 0.25, 0.5, 0.75, 1].map((k) => ({
    top: (1 - k) * 100 + "%",
    l: formatValue(mx * k, u),
  }));
  const xt = [0, 0.25, 0.5, 0.75, 1].map((k) => ({
    f: k,
    l: k === 1 && liveEnd && !zoomed ? L.now : tl(from + span * k),
    tx: k === 0 ? "none" : k === 1 ? "translateX(-100%)" : "translateX(-50%)",
  }));

  const zoomTo = (a: number, b: number) => {
    if (props.onZoom) props.onZoom(a, b);
    else setZw([a, b]);
  };
  const reset = () => {
    if (zw) setZw(null);
    else props.onReset?.();
  };
  const setHover = (t: number | null) => {
    if (props.onHover) props.onHover(t);
    else setHov(t);
  };

  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const a = frac(e.clientX);
    setDrag({ a, b: a });
    unbindRef.current?.();
    const mm = (ev: MouseEvent) => {
      const b = frac(ev.clientX);
      setDrag((d) => (d ? { ...d, b } : d));
    };
    const mu = (ev: MouseEvent) => {
      unbind();
      const b = frac(ev.clientX);
      setDrag(null);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (hi - lo > 0.015) zoomTo(from + span * lo, from + span * hi);
    };
    const unbind = () => {
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
      unbindRef.current = null;
    };
    unbindRef.current = unbind;
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
  };

  const da = drag ? Math.min(drag.a, drag.b) : 0;
  const db = drag ? Math.max(drag.a, drag.b) : 0;
  const dragging = !!drag && db - da > 0.002;

  const stats = shown.map((x) => {
    const v = x.points
      .map(([, y]) => y)
      .filter((y): y is number => y != null && !Number.isNaN(y))
      .sort((a, b) => a - b);
    const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    const max = v.length ? v[v.length - 1]! : null;
    return {
      n: x.n,
      c: x.c,
      min: formatValue(v[0], u),
      avg: formatValue(avg, u),
      p95: formatValue(v.length ? v[Math.min(v.length - 1, Math.floor(v.length * 0.95))] : null, u),
      max: formatValue(max, u),
      last: formatValue(lastValue(x.points), u),
      maxInk: thr && max != null && max > thr.v ? "var(--wait)" : "var(--ink)",
    };
  });

  const h = fs ? Math.max(260, vh - 330) : height;
  const rangeL = `${tl(from)} – ${tl(to)}`;
  const resL = fill(L.resolution, "step", formatStep(stepMs));
  const big = first ? formatValue(firstVal, u) : "—";
  const bigInk = thrHit || spec.hot ? "var(--dang)" : "var(--ink)";

  const toggleFs = () => {
    setPh(outerRef.current?.offsetHeight ?? 0);
    if (typeof window !== "undefined") setVh(window.innerHeight);
    setFs((v) => !v);
  };

  const card = (
    <div
      style={{
        position: fs ? "fixed" : "relative",
        inset: fs ? 28 : "auto",
        zIndex: fs ? 120 : "auto",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        boxShadow: fs ? "var(--shadow-modal)" : "var(--shadow-card)",
        padding: fs ? "20px 24px" : "14px 16px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
        overflow: fs ? "auto" : "visible",
        fontFamily: "Inter, system-ui, sans-serif",
        color: "var(--ink)",
      }}
      data-screen-label={fs ? `${spec.title} — full screen` : spec.title}
      data-testid={props.testId}
      data-fullscreen={fs ? "true" : undefined}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: fs ? 18 : 13, fontWeight: 600, whiteSpace: "nowrap" }}>
              {spec.title}
            </span>
            {spec.sub ? (
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--ink-3)",
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {spec.sub}
              </span>
            ) : null}
          </div>
          {fs && (
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {rangeL} · {resL}
            </span>
          )}
        </div>
        {zoomed && (
          <span
            role="button"
            tabIndex={0}
            onClick={reset}
            onKeyDown={(e) => e.key === "Enter" && reset()}
            data-chart-reset=""
            style={{
              height: 24,
              padding: "0 9px",
              borderRadius: 7,
              background: "var(--brand-t)",
              color: "var(--brand)",
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {L.resetZoom}
          </span>
        )}
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: fs ? 22 : 13,
            fontWeight: 600,
            color: bigInk,
            whiteSpace: "nowrap",
            lineHeight: 1.2,
          }}
          data-chart-big=""
        >
          {big}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={toggleFs}
          onKeyDown={(e) => e.key === "Enter" && toggleFs()}
          title={fs ? L.exitFullScreen : L.fullScreen}
          aria-label={fs ? L.exitFullScreen : L.fullScreen}
          className="oi-hover"
          data-chart-fullscreen=""
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            border: "1px solid var(--line)",
            display: "grid",
            placeItems: "center",
            fontSize: 13,
            color: "var(--ink-2)",
            cursor: "pointer",
            flex: "none",
          }}
        >
          {fs ? "✕" : "⤢"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {all.map((x) => (
          <span
            key={x.n}
            role="button"
            tabIndex={0}
            aria-pressed={x.on}
            onClick={() => setHidden((st) => ({ ...st, [x.n]: !st[x.n] }))}
            onKeyDown={(e) => e.key === "Enter" && setHidden((st) => ({ ...st, [x.n]: !st[x.n] }))}
            className="oi-hover"
            data-chart-legend={x.n}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 22,
              padding: "0 8px",
              borderRadius: 6,
              cursor: "pointer",
              opacity: x.on ? 1 : 0.45,
              background: "transparent",
            }}
          >
            <span
              style={{
                width: 10,
                height: x.dash ? 0 : 3,
                borderRadius: 2,
                background: x.c,
                borderTop: x.dash ? `2px dashed ${x.c}` : "none",
              }}
            />
            <span style={{ fontSize: 11.5, color: "var(--ink-2)", whiteSpace: "nowrap" }}>
              {x.n}
            </span>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--ink)",
                whiteSpace: "nowrap",
              }}
            >
              {x.on ? formatValue(valueAt(x), u) : L.hidden}
            </span>
          </span>
        ))}
      </div>

      <div
        style={{
          position: "relative",
          height: h,
          display: "flex",
          minWidth: 0,
          flex: fs ? "1 1 auto" : "none",
        }}
      >
        <div style={{ position: "relative", width: 48, flex: "none" }}>
          {yt.map((y) => (
            <span
              key={y.top}
              style={{
                position: "absolute",
                right: 8,
                top: y.top,
                transform: "translateY(-50%)",
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: "var(--ink-3)",
                whiteSpace: "nowrap",
              }}
            >
              {y.l}
            </span>
          ))}
        </div>
        <div
          ref={plotRef}
          onMouseDown={onDown}
          onMouseMove={(e) => setHover(from + span * frac(e.clientX))}
          onMouseLeave={() => setHover(null)}
          onDoubleClick={reset}
          data-chart-plot=""
          style={{
            position: "relative",
            flex: 1,
            minWidth: 0,
            cursor: "crosshair",
            userSelect: "none",
            borderBottom: "1px solid var(--line)",
          }}
        >
          {yt.map((y) => (
            <span
              key={y.top}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: y.top,
                borderTop: "1px solid var(--line-2)",
                pointerEvents: "none",
              }}
            />
          ))}
          {bands.map((b) => (
            <span key={b.key}>
              <span
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: b.l,
                  width: b.w,
                  background: b.bg,
                  pointerEvents: "none",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: 4,
                  left: `calc(${b.l} + 6px)`,
                  fontSize: 10,
                  fontWeight: 700,
                  color: b.ink,
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                }}
              >
                {b.label}
              </span>
            </span>
          ))}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <svg
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              width="100%"
              height="100%"
              style={{ display: "block", overflow: "visible" }}
            >
              {paths}
            </svg>
          </div>
          {!hasData && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                fontSize: 12,
                color: "var(--ink-3)",
                pointerEvents: "none",
                textAlign: "center",
                padding: "0 12px",
              }}
              data-chart-empty=""
            >
              {spec.empty ?? L.noData}
            </div>
          )}
          {thr && (
            <span
              style={{
                position: "absolute",
                right: 4,
                top: Y(thr.v) / 10 + "%",
                transform: "translateY(-120%)",
                fontSize: 10,
                fontWeight: 600,
                color: "var(--wait)",
                background: "var(--panel)",
                padding: "0 4px",
                borderRadius: 4,
                pointerEvents: "none",
                whiteSpace: "nowrap",
              }}
            >
              {thr.l}
            </span>
          )}
          {marks.map((m) => (
            <span key={m.key}>
              <span
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: m.l,
                  borderLeft: `1.5px dashed ${m.c}`,
                  pointerEvents: "none",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  bottom: 4,
                  left: m.l,
                  transform: m.tx,
                  fontSize: 10,
                  fontWeight: 700,
                  color: m.c,
                  background: m.bg,
                  borderRadius: 4,
                  padding: "1px 5px",
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                }}
              >
                {m.label}
              </span>
            </span>
          ))}
          {dragging && (
            <>
              <span
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: pct(da),
                  width: pct(db - da),
                  background: "rgba(11,74,111,.10)",
                  borderLeft: "1px solid var(--brand)",
                  borderRight: "1px solid var(--brand)",
                  pointerEvents: "none",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: 6,
                  left: `calc(${pct(da)} + ${pct(db - da)} / 2)`,
                  transform: "translateX(-50%)",
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: "var(--brand)",
                  color: "#fff",
                  borderRadius: 5,
                  padding: "2px 7px",
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                }}
              >
                {tl(from + span * da)} → {tl(from + span * db)}
              </span>
            </>
          )}
          {hovering && (
            <>
              <span
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: pct(hf),
                  borderLeft: "1px solid var(--ink-3)",
                  pointerEvents: "none",
                }}
              />
              {shown.map((x) => {
                const v = valueAt(x);
                if (v == null) return null;
                return (
                  <span
                    key={x.n}
                    style={{
                      position: "absolute",
                      left: pct(hf),
                      top: Y(v) / 10 + "%",
                      width: 8,
                      height: 8,
                      margin: "-4px 0 0 -4px",
                      borderRadius: "50%",
                      background: x.c,
                      boxShadow: "0 0 0 2px var(--panel)",
                      pointerEvents: "none",
                    }}
                  />
                );
              })}
              {tooltip && (
                <div
                  data-chart-tooltip=""
                  style={{
                    position: "absolute",
                    top: 8,
                    left: pct(hf),
                    transform: hf > 0.62 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
                    minWidth: 180,
                    background: "var(--topbar-dark)",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "8px 10px",
                    boxShadow: "var(--shadow-pop)",
                    pointerEvents: "none",
                    zIndex: 3,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: "rgba(255,255,255,.65)",
                    }}
                  >
                    {tl(snapT!)}
                  </span>
                  {shown.map((x) => (
                    <span
                      key={x.n}
                      style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: x.c,
                          flex: "none",
                        }}
                      />
                      <span
                        style={{ flex: 1, whiteSpace: "nowrap", color: "rgba(255,255,255,.85)" }}
                      >
                        {x.n}
                      </span>
                      <span
                        style={{ fontFamily: "var(--mono)", fontWeight: 600, whiteSpace: "nowrap" }}
                      >
                        {formatValue(valueAt(x), u)}
                      </span>
                    </span>
                  ))}
                  {(mk || thrHit) && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "#F5B544",
                        borderTop: "1px solid rgba(255,255,255,.12)",
                        paddingTop: 4,
                        marginTop: 2,
                      }}
                    >
                      {mk ? mk.l : fill(L.aboveThreshold, "label", thr?.l ?? "")}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <div style={{ display: "flex", paddingLeft: 48, position: "relative", height: 14 }}>
        {xt.map((x) => (
          <span
            key={x.f}
            style={{
              position: "absolute",
              left: `calc(48px + (100% - 48px) * ${x.f})`,
              transform: x.tx,
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--ink-3)",
              whiteSpace: "nowrap",
            }}
          >
            {x.l}
          </span>
        ))}
      </div>
      {!fs && hint && (
        <div style={{ fontSize: 10.5, color: "var(--ink-3)", paddingLeft: 48 }}>{L.hint}</div>
      )}

      {fs && (
        <>
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 12,
              overflow: "hidden",
              marginTop: 6,
              flex: "none",
            }}
            data-chart-stats=""
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(160px,1fr) repeat(5,110px)",
                gap: 10,
                padding: "8px 14px",
                background: "var(--sunk)",
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
              }}
            >
              <span>{fill(L.seriesHead, "range", rangeL)}</span>
              <span style={{ textAlign: "right" }}>{L.min}</span>
              <span style={{ textAlign: "right" }}>{L.avg}</span>
              <span style={{ textAlign: "right" }}>{L.p95}</span>
              <span style={{ textAlign: "right" }}>{L.max}</span>
              <span style={{ textAlign: "right" }}>{L.last}</span>
            </div>
            {stats.map((st) => (
              <div
                key={st.n}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(160px,1fr) repeat(5,110px)",
                  gap: 10,
                  padding: "8px 14px",
                  borderTop: "1px solid var(--line-2)",
                  fontSize: 12.5,
                  alignItems: "center",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 10, height: 3, borderRadius: 2, background: st.c }} />
                  {st.n}
                </span>
                <span style={{ textAlign: "right", fontFamily: "var(--mono)" }}>{st.min}</span>
                <span style={{ textAlign: "right", fontFamily: "var(--mono)" }}>{st.avg}</span>
                <span style={{ textAlign: "right", fontFamily: "var(--mono)" }}>{st.p95}</span>
                <span
                  style={{
                    textAlign: "right",
                    fontFamily: "var(--mono)",
                    color: st.maxInk,
                    fontWeight: 600,
                  }}
                >
                  {st.max}
                </span>
                <span style={{ textAlign: "right", fontFamily: "var(--mono)" }}>{st.last}</span>
              </div>
            ))}
          </div>
          <div
            style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--ink-3)", flex: "none" }}
          >
            <span>{L.fsDrag}</span>
            <span>{L.fsLegend}</span>
            <span>{L.fsEsc}</span>
          </div>
        </>
      )}
    </div>
  );

  if (!fs) {
    return (
      <div ref={outerRef} style={{ minWidth: 0 }}>
        {card}
      </div>
    );
  }
  const layer = (
    <>
      <div
        onClick={() => setFs(false)}
        style={{ position: "fixed", inset: 0, zIndex: 119, background: "rgba(13,22,28,.5)" }}
      />
      {card}
    </>
  );
  return (
    <div ref={outerRef} style={{ minWidth: 0, height: ph ? ph : "auto" }}>
      {props.portal ? props.portal(layer) : layer}
    </div>
  );
}
