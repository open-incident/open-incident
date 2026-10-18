"use client";

/**
 * The chart, as the app uses it: translated, in the workspace's timezone,
 * mounted full screen through a portal, and grouped.
 *
 * A `ChartBoard` is a set of charts that share one crosshair and one window.
 * Hovering one moves the crosshair on all of them; dragging a window on one
 * zooms all of them — the window is written to the address (`from`, `to`), so
 * the server reads the new range again at a finer resolution, and the zoom is
 * a link somebody can send. Until the new points arrive the charts already
 * show the dragged window, cut from the coarse ones.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TimeSeriesChart, type ChartLabels, type ChartSpec } from "@openincident/ui";
import { useT } from "@/i18n/client";

export function useChartLabels(): ChartLabels {
  const t = useT();
  return useMemo(
    () => ({
      resetZoom: t("chart.resetZoom"),
      fullScreen: t("chart.fullScreen"),
      exitFullScreen: t("chart.exitFullScreen"),
      now: t("chart.now"),
      hidden: t("chart.hidden"),
      hint: t("chart.hint"),
      fsDrag: t("chart.fsDrag"),
      fsLegend: t("chart.fsLegend"),
      fsEsc: t("chart.fsEsc"),
      seriesHead: t("chart.seriesHead", { range: "{range}" }),
      min: t("chart.min"),
      avg: t("chart.avg"),
      p95: t("chart.p95"),
      max: t("chart.max"),
      last: t("chart.last"),
      resolution: t("chart.resolution", { step: "{step}" }),
      aboveThreshold: t("chart.aboveThreshold", { label: "{label}" }),
      dayAgo: t("chart.dayAgo", { name: "{name}" }),
      noData: t("chart.noData"),
    }),
    [t],
  );
}

const toBody = (node: ReactNode) =>
  typeof document === "undefined" ? node : createPortal(node, document.body);

type Board = {
  from: number;
  to: number;
  hoverT: number | null;
  setHover: (t: number | null) => void;
  zoom: (a: number, b: number) => void;
  reset: () => void;
  zoomed: boolean;
  compare: boolean;
  pending: boolean;
  /** The window ends at the present: the axis says "now". */
  live: boolean;
};

const BoardContext = createContext<Board | null>(null);

/** The board's window, for the banners and chips that sit above the charts. */
export function useBoard(): Board {
  const b = useContext(BoardContext);
  if (!b) throw new Error("useBoard() outside <ChartBoard>");
  return b;
}

/**
 * Shared crosshair and window for every chart inside.
 *
 * `from`/`to` are the server's window. `zoomed` is whether the address carries
 * a dragged window; resetting removes it and keeps every other parameter.
 */
export function ChartBoard({
  from,
  to,
  zoomed,
  compare = false,
  live = true,
  children,
}: {
  from: number;
  to: number;
  zoomed: boolean;
  compare?: boolean;
  live?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [hoverT, setHover] = useState<number | null>(null);
  const [local, setLocal] = useState<[number, number] | null>(null);
  const [pending, start] = useTransition();

  // The server answered with a new window: the optimistic one has done its job.
  useEffect(() => setLocal(null), [from, to]);

  const go = useCallback(
    (next: URLSearchParams) => {
      start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
    },
    [pathname, router],
  );
  const zoom = useCallback(
    (a: number, b: number) => {
      setLocal([a, b]);
      setHover(null);
      const next = new URLSearchParams(params.toString());
      next.set("from", String(Math.round(a)));
      next.set("to", String(Math.round(b)));
      go(next);
    },
    [go, params],
  );
  const reset = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("from");
    next.delete("to");
    setLocal(null);
    go(next);
  }, [go, params]);

  const [f, t] = local ?? [from, to];
  const value = useMemo(
    () => ({
      from: f,
      to: t,
      hoverT,
      setHover,
      zoom,
      reset,
      zoomed: zoomed || !!local,
      compare,
      pending,
      live,
    }),
    [f, t, hoverT, zoom, reset, zoomed, local, compare, pending, live],
  );
  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}

/** One chart of a board — or alone, with its own window, when there is no board. */
export function Chart({
  spec,
  height,
  hint = false,
  testId,
  from,
  to,
}: {
  spec: ChartSpec;
  height?: number;
  hint?: boolean;
  testId?: string;
  from?: number;
  to?: number;
}) {
  const t = useT();
  const labels = useChartLabels();
  const board = useContext(BoardContext);
  return (
    <TimeSeriesChart
      spec={spec}
      from={board?.from ?? from ?? Date.now() - 3_600_000}
      to={board?.to ?? to ?? Date.now()}
      height={height}
      hint={hint}
      hoverT={board ? board.hoverT : undefined}
      onHover={board ? board.setHover : undefined}
      onZoom={board ? board.zoom : undefined}
      onReset={board ? board.reset : undefined}
      zoomed={board?.zoomed}
      liveEnd={board ? board.live && !board.zoomed : true}
      compare={board?.compare}
      labels={labels}
      locale={t.locale.code === "en" ? "en-US" : t.locale.tag}
      timeZone={t.timeZone}
      portal={toBody}
      testId={testId}
    />
  );
}
