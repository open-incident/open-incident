/**
 * Archive windows: Opsgenie's alert search reaches 20 000 alerts at most
 * (offset + limit), so the history is read in date windows that each hold
 * fewer — calendar quarters, halved until they fit.
 */
import { SEARCH_CEILING, windowQuery, type OpsgenieClient } from "./client";

export type ArchiveWindow = {
  from: string;
  to: string;
  /** "2025 Q1", or a date range when a quarter had to be split. */
  label: string;
  count: number;
  /** How far into the window the archive got (the search offset), and what it kept. */
  offset: number;
  imported: number;
  skipped: number;
  done: boolean;
};

/** Calendar quarters (UTC) from the first alert to `to`. */
export function quarters(from: Date, to: Date): Array<{ from: Date; to: Date; label: string }> {
  const out: Array<{ from: Date; to: Date; label: string }> = [];
  let y = from.getUTCFullYear();
  let q = Math.floor(from.getUTCMonth() / 3);
  for (let guard = 0; guard < 200; guard++) {
    const start = new Date(Date.UTC(y, q * 3, 1));
    const end = new Date(Date.UTC(q === 3 ? y + 1 : y, q === 3 ? 0 : q * 3 + 3, 1));
    if (start.getTime() >= to.getTime()) break;
    out.push({
      from: start,
      to: end.getTime() > to.getTime() ? to : end,
      label: `${y} Q${q + 1}`,
    });
    q += 1;
    if (q === 4) {
      q = 0;
      y += 1;
    }
  }
  return out;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Splits [from, to) until every window counts fewer than the ceiling.
 * `count` is injected so the tests can plan without a network.
 */
export async function splitUnderCeiling(
  span: { from: Date; to: Date; label: string },
  count: (from: Date, to: Date) => Promise<number>,
  ceiling = SEARCH_CEILING,
): Promise<ArchiveWindow[]> {
  const n = await count(span.from, span.to);
  const tooShort = span.to.getTime() - span.from.getTime() < 3_600_000;
  if (n < ceiling || tooShort)
    return [
      {
        from: span.from.toISOString(),
        to: span.to.toISOString(),
        label: span.label,
        count: n,
        offset: 0,
        imported: 0,
        skipped: 0,
        done: n === 0,
      },
    ];
  const mid = new Date(Math.floor((span.from.getTime() + span.to.getTime()) / 2));
  const left = { from: span.from, to: mid, label: `${iso(span.from)} → ${iso(mid)}` };
  const right = { from: mid, to: span.to, label: `${iso(mid)} → ${iso(span.to)}` };
  return [
    ...(await splitUnderCeiling(left, count, ceiling)),
    ...(await splitUnderCeiling(right, count, ceiling)),
  ];
}

export async function planWindows(
  client: OpsgenieClient,
  firstAlertAt: Date,
  until: Date,
): Promise<ArchiveWindow[]> {
  const out: ArchiveWindow[] = [];
  for (const q of quarters(firstAlertAt, until))
    out.push(...(await splitUnderCeiling(q, (f, t) => client.countAlerts(windowQuery(f, t)))));
  return out;
}
