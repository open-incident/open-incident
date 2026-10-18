/**
 * How a chart spells its numbers and its instants.
 *
 * The rules are the design's (`V2Chart`), with one widening: the design only
 * ever drew busy services, so a rate below ten was rounded to zero. A real
 * workspace with three requests a minute is not "0 /s", and printing that on
 * an axis says the service is dead — small rates keep their decimals.
 */

export type ChartUnit = "ms" | "%" | "rps" | "mb" | "n" | (string & {});

export function formatValue(v: number | null | undefined, unit?: ChartUnit): string {
  if (v == null || Number.isNaN(v)) return "—";
  if (unit === "ms") {
    if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 1 : 2) + " s";
    if (v > 0 && v < 1) return v.toFixed(2) + " ms";
    return Math.round(v) + " ms";
  }
  if (unit === "%") return (v < 10 ? v.toFixed(2) : v.toFixed(1)) + " %";
  if (unit === "rps") {
    if (v >= 1000) return (v / 1000).toFixed(1) + "k /s";
    if (v >= 10 || v === 0) return Math.round(v) + " /s";
    return v.toFixed(v < 1 ? 2 : 1) + " /s";
  }
  if (unit === "mb") return v >= 1024 ? (v / 1024).toFixed(2) + " GB" : Math.round(v) + " MB";
  if (unit === "n") {
    if (v >= 1000) return (v / 1000).toFixed(1) + "k";
    if (v > 0 && v < 10 && !Number.isInteger(v)) return v.toFixed(1);
    return String(Math.round(v));
  }
  return String(Math.round(v * 10) / 10) + (unit ? " " + unit : "");
}

/** The next "round" number at or above `m` — what the y axis tops out at. */
export function niceCeiling(m: number): number {
  if (!(m > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(m)));
  for (const k of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= m) return k * p;
  return 10 * p;
}

const DAY = 86_400_000;

/**
 * An instant as the axis writes it: `21:38`, `21:38:04` once the window is
 * twenty minutes or less, and `Oct 12 21:38` once it is more than a day and a
 * half — the same three cases as the design.
 */
export function formatInstant(
  t: number,
  spanMs: number,
  opts: { locale?: string; timeZone?: string } = {},
): string {
  const d = new Date(t);
  const base: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  };
  const time = new Intl.DateTimeFormat(opts.locale ?? "en-GB", {
    ...base,
    ...(spanMs <= 20 * 60_000 ? { second: "2-digit" } : {}),
  }).format(d);
  if (spanMs > DAY * 1.5) {
    const day = new Intl.DateTimeFormat(opts.locale ?? "en-US", {
      month: "short",
      day: "numeric",
      ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
    }).format(d);
    return `${day} ${time}`;
  }
  return time;
}

/** A step as the full-screen header says it: "resolution 45 s", "resolution 5 min". */
export function formatStep(stepMs: number): string {
  if (stepMs < 60_000) return `${Math.max(1, Math.round(stepMs / 1000))} s`;
  if (stepMs < 3_600_000) return `${Math.round(stepMs / 60_000)} min`;
  if (stepMs < DAY) return `${Math.round(stepMs / 3_600_000)} h`;
  return `${Math.round(stepMs / DAY)} d`;
}

/** A duration for the zoom chips: "4 min", "1.5 h", "38 s". */
export function formatSpan(spanMs: number): string {
  const min = spanMs / 60_000;
  if (min < 1) return `${Math.round(spanMs / 1000)} s`;
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 60 * 48) return `${(min / 60).toFixed(1)} h`;
  return `${(min / 1440).toFixed(1)} d`;
}
