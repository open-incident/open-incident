/**
 * What to keep when a workspace is sending more than it pays for.
 *
 * The column this serves says "past it, a notice and forced sampling — never a
 * silent cut", and every decision below follows from that sentence.
 *
 * Two things are deliberately *not* here:
 *
 *  - **This is not tail sampling.** Tail sampling means holding a whole trace
 *    until it is finished and then deciding, which needs a buffer that sees
 *    every span of that trace. An ingestion endpoint sees one HTTP request at
 *    a time and the spans of one trace arrive in several, often from several
 *    senders. The real tail sampler is a gateway collector — `docker/collector/
 *    tail-sampling.yaml` — placed where the whole trace passes. What is here
 *    is a budget guard: the last line, not the intended one.
 *  - **Metrics, profiles and RUM are never sampled.** Dropping metric points
 *    breaks every chart and every `rate()` silently, and the other two are a
 *    rounding error in the volume. Logs and traces are where the gigabytes
 *    are, so logs and traces are what bends.
 */

/** OTel severity numbers: 17 is where ERROR starts, 21 FATAL. */
const ERROR_SEVERITY = 17;

/**
 * The floor. A workspace sending a thousand times its cap still gets one row
 * in a hundred, because a screen that has gone completely dark is
 * indistinguishable from an outage and this is a billing problem.
 */
export const MIN_KEEP = 0.01;

/**
 * The share of ordinary traffic to keep, from the cap and the day so far.
 *
 * `cap / used` — "keep the fraction that would have fitted". It is one
 * sentence, which matters more than it sounds: somebody over their cap is
 * going to ask why they have the rows they have, and the answer has to be
 * sayable.
 *
 * What it costs: the day's stored volume is the integral of that rate, which
 * is `cap · (1 + ln(raw / cap))` — logarithmic, not flat. Sending twice the
 * cap stores 1.7× it, ten times stores 3.3×, a hundred times stores 5.6×. That
 * is the honest number and it is the right shape for a cap called *soft*: it
 * bends hard enough to matter and never becomes the silent cut the schema
 * forbids. A hard stop belongs to a separate decision somebody makes on
 * purpose.
 *
 * `used` must be the **raw** bytes received, not the bytes stored, or the loop
 * oscillates: sampling lowers stored volume, which raises the rate, which
 * raises stored volume. Raw only ever climbs, so the rate only ever falls.
 */
export function keepRate(capBytes: number | null, usedBytes: number): number {
  if (!capBytes || capBytes <= 0) return 1;
  if (usedBytes <= capBytes) return 1;
  return Math.max(MIN_KEEP, capBytes / usedBytes);
}

/** FNV-1a, 32-bit. Cheap, and stable across processes and restarts. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Whether a trace survives — decided from the trace id alone.
 *
 * Deterministic on purpose, and it is the single most important line in the
 * file. The spans of one trace arrive in different requests, minutes apart,
 * from different processes; a coin flipped per span or per batch would keep
 * three spans of a nine-span trace and store a waterfall with holes in it.
 * A trace with holes is worse than an absent trace, because the absent one
 * doesn't get read as evidence.
 */
export function keepTrace(traceId: string, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return hash32(traceId) / 0x1_0000_0000 < rate;
}

export type Sampled<T> = {
  kept: T[];
  dropped: number;
  /** What one kept row stands for, so counts can be corrected at read time. */
  ratioFor: (row: T) => number;
};

type SpanLike = { traceId: string; statusCode: string; hasException: boolean };

/**
 * Spans, thinned.
 *
 * Anything that failed is kept, and so is every other span of a trace that
 * failed *in this batch* — a stack trace with no parent span above it names a
 * function and nothing else, where the same trace whole names the request.
 *
 * The limit of that is real and worth stating: a trace whose error span
 * arrived in an earlier request is not recognised here, and takes its chances
 * on the draw. Buffering to fix it would be tail sampling, which belongs at
 * the gateway, in front of this.
 */
export function sampleSpans<T extends SpanLike>(spans: T[], rate: number): Sampled<T> {
  if (rate >= 1) return { kept: spans, dropped: 0, ratioFor: () => 1 };

  const failed = new Set<string>();
  for (const s of spans) {
    if (s.statusCode === "error" || s.hasException) failed.add(s.traceId);
  }

  const kept: T[] = [];
  for (const s of spans) {
    if (failed.has(s.traceId) || keepTrace(s.traceId, rate)) kept.push(s);
  }
  // A kept error span stands for itself: none of its kind were dropped, so
  // weighting it would inflate the error count. Only the draw is weighted.
  const weight = 1 / rate;
  return {
    kept,
    dropped: spans.length - kept.length,
    ratioFor: (s) => (failed.has(s.traceId) ? 1 : weight),
  };
}

type LogLike = { traceId: string; severityNumber: number };

/**
 * Logs, thinned.
 *
 * Three populations, three rules. An error keeps its place whatever the
 * budget. A log carrying a trace id follows its trace — the same hash as the
 * spans, so a kept trace still has its lines under it and a dropped one leaves
 * nothing dangling. A log with no trace has no correlation to preserve, so it
 * is drawn at random: hashing its text instead would keep the same lines
 * forever and hide the others permanently, which is a worse failure than an
 * honest thinning.
 *
 * `isError` is injected rather than assumed, and the default here is the weak
 * version of the question. Severity is not the whole answer: a logger that
 * writes `err.stack` at WARN, or an SDK that attaches `exception.type` to an
 * INFO line, produces an exception the product will group and alert on — and
 * "errors are never sampled" has to be true of those too, or the promise is a
 * sentence rather than a rule. The ingestion path passes the same detector
 * that decides what becomes an exception, so the two cannot drift.
 */
export function sampleLogs<T extends LogLike>(
  logs: T[],
  rate: number,
  isError: (log: T) => boolean = (l) => l.severityNumber >= ERROR_SEVERITY,
): Sampled<T> {
  if (rate >= 1) return { kept: logs, dropped: 0, ratioFor: () => 1 };

  // Asked once per row and remembered: the real predicate parses, and the
  // weighting asks the same question again afterwards.
  const forced = new Set<T>();
  const kept: T[] = [];
  for (const l of logs) {
    const must = isError(l);
    if (must) forced.add(l);
    const drawn = l.traceId ? keepTrace(l.traceId, rate) : Math.random() < rate;
    if (must || drawn) kept.push(l);
  }
  const weight = 1 / rate;
  return {
    kept,
    dropped: logs.length - kept.length,
    ratioFor: (l) => (forced.has(l) ? 1 : weight),
  };
}

/**
 * The sentence the sender is told, in the protocol's own partial-success
 * field. Silence would be the cut the column forbids.
 */
export function samplingNotice(dropped: number, rate: number): string {
  const oneIn = Math.round(1 / rate);
  return `over the workspace's daily soft cap: ${dropped} row(s) sampled out, keeping about 1 in ${oneIn}. Errors are never sampled.`;
}
