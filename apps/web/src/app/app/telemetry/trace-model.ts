import type { SpanRow } from "@/lib/telemetry";

/**
 * The arithmetic behind the waterfall, kept away from the drawing.
 *
 * Every number the screen shows — the order of the rows, a service's colour,
 * what is on the critical path, how much time a service really spent — is
 * derived here and tested here. A waterfall that computes while it renders is
 * a waterfall nobody can check.
 */

export type TraceNode = {
  span: SpanRow;
  depth: number;
  startMs: number;
  durationMs: number;
  /** Time in this span that is not inside a child. What "slow" actually means. */
  selfMs: number;
  critical: boolean;
  colour: string;
};

/**
 * The palette, assigned per trace in the order services first appear.
 *
 * Stable within a trace, which is what matters: the eye learns "blue is
 * checkout-api" over one screen. Not stable across traces, and deliberately
 * not hashed from the name — a hash gives two services in the same trace the
 * same colour often enough to be a bug somebody reports.
 */
export const SERVICE_COLOURS = [
  "#1d4ed8",
  "#0e7a58",
  "#b45309",
  "#7c3aed",
  "#c0342b",
  "#0891b2",
  "#a16207",
  "#be185d",
] as const;

export function coloursFor(spans: SpanRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of spans) {
    if (!out.has(s.service_name)) {
      out.set(s.service_name, SERVICE_COLOURS[out.size % SERVICE_COLOURS.length]!);
    }
  }
  return out;
}

const ms = (span: SpanRow) => Number(span.duration_ns) / 1e6;

/**
 * The spans in tree order: a parent immediately followed by its children,
 * children by start time.
 *
 * Not arrival order, and not start order across the whole trace. Spans of one
 * trace reach us from several services, out of sequence, and a list sorted by
 * start alone interleaves branches — the reader then cannot tell which call
 * made which. A span whose parent is missing (sampled away, or still in
 * flight) is drawn at the root rather than dropped, because "we did not
 * receive that one" is information.
 */
export function traceTree(spans: SpanRow[]): TraceNode[] {
  if (spans.length === 0) return [];
  const byId = new Map(spans.map((s) => [s.span_id, s]));
  const children = new Map<string, SpanRow[]>();
  const roots: SpanRow[] = [];
  for (const s of spans) {
    const parent = s.parent_span_id && byId.get(s.parent_span_id);
    if (parent && parent.span_id !== s.span_id) {
      children.set(parent.span_id, [...(children.get(parent.span_id) ?? []), s]);
    } else {
      roots.push(s);
    }
  }
  const t0 = Math.min(...spans.map((s) => Date.parse(s.start_ts)));
  const colours = coloursFor(spans);
  const critical = criticalPath(children, roots);

  const out: TraceNode[] = [];
  const walk = (span: SpanRow, depth: number, guard: number) => {
    // A cycle cannot happen in a well-formed trace and does happen in a badly
    // instrumented one; the guard is what stops the page hanging over it.
    if (guard > 64) return;
    const kids = (children.get(span.span_id) ?? []).sort(
      (a, b) => Date.parse(a.start_ts) - Date.parse(b.start_ts),
    );
    out.push({
      span,
      depth,
      startMs: Date.parse(span.start_ts) - t0,
      durationMs: ms(span),
      selfMs: Math.max(0, ms(span) - kids.reduce((n, k) => n + ms(k), 0)),
      critical: critical.has(span.span_id),
      colour: colours.get(span.service_name) ?? SERVICE_COLOURS[0],
    });
    for (const kid of kids) walk(kid, depth + 1, guard + 1);
  };
  for (const root of roots.sort((a, b) => Date.parse(a.start_ts) - Date.parse(b.start_ts))) {
    walk(root, 0, 0);
  }
  return out;
}

/**
 * The spans that decide how long the trace took.
 *
 * Not a chain, and that is the whole correction. The obvious implementation —
 * "from each span, follow the child that finishes last" — is wrong in a way
 * that looks right until you meet a real trace: a 22 ms `emit order.failed`
 * fired after everything else finishes last, so the naive walk marks it and
 * ignores the three-second database call the request was actually waiting on.
 *
 * The real definition is the one an APM has to use: walk **backwards** from a
 * span's end. Whatever child covers the current instant is what the parent was
 * waiting on then, so mark it, recurse into it, and jump the cursor back to
 * that child's start. Time no child covers is the parent's own work. Repeat
 * until the cursor reaches the span's start.
 *
 * That yields a *set* — a parent can be waiting on one child, then doing its
 * own work, then waiting on another — which is what the highlighting shows.
 * Making anything in this set faster makes the request faster; making anything
 * outside it faster changes nothing.
 */
function criticalPath(children: Map<string, SpanRow[]>, roots: SpanRow[]): Set<string> {
  const out = new Set<string>();
  const startOf = (s: SpanRow) => Date.parse(s.start_ts);
  const endOf = (s: SpanRow) => startOf(s) + ms(s);

  const walk = (span: SpanRow, guard: number) => {
    if (guard > 64 || out.has(span.span_id)) return;
    out.add(span.span_id);
    const kids = (children.get(span.span_id) ?? []).slice().sort((a, b) => endOf(b) - endOf(a));
    let cursor = endOf(span);
    for (const kid of kids) {
      // A child that begins at or after the cursor ran in parallel with one we
      // have already taken — it covers none of the time still unaccounted for.
      if (startOf(kid) >= cursor) continue;
      if (endOf(kid) <= startOf(span)) break; // finished before this span began
      // A child may END AFTER ITS PARENT. Clocks differ between services by a
      // few milliseconds and spans are stamped where they run, so the overrun
      // is normal data, not corruption. Skipping those children — which an
      // `endOf(kid) > cursor` guard does — drops exactly the one the parent was
      // waiting on when it finished.
      walk(kid, guard + 1);
      cursor = Math.min(cursor, startOf(kid));
      if (cursor <= startOf(span)) break;
    }
  };

  // The root that finishes last: a trace can legitimately have several.
  const first = roots.slice().sort((a, b) => endOf(b) - endOf(a))[0];
  if (first) walk(first, 0);
  return out;
}

/**
 * Self time per service, largest first.
 *
 * Self time, not total: a front-end span that waits three seconds on a
 * database has not spent three seconds of its own, and a chart that says it
 * has sends somebody to optimise the wrong service. This is the number that
 * answers "where did the time actually go".
 */
export function timeByService(
  nodes: TraceNode[],
): Array<{ service: string; ms: number; colour: string; share: number }> {
  const totals = new Map<string, { ms: number; colour: string }>();
  for (const n of nodes) {
    const held = totals.get(n.span.service_name);
    totals.set(n.span.service_name, {
      ms: (held?.ms ?? 0) + n.selfMs,
      colour: n.colour,
    });
  }
  const whole = [...totals.values()].reduce((n, v) => n + v.ms, 0) || 1;
  return [...totals.entries()]
    .map(([service, v]) => ({ service, ms: v.ms, colour: v.colour, share: v.ms / whole }))
    .sort((a, b) => b.ms - a.ms);
}

/**
 * Round numbers on the axis, so the ticks read 0 · 1 s · 2 s rather than
 * 0 · 1.03 s · 2.06 s.
 *
 * The step is the **largest** nice number that still fits under the target
 * spacing, not the first one above it. Taking the first one above turns a
 * 4.12 s trace into three ticks — 0, 2 s, 4 s — where five is what the eye
 * wants and what every other profiler draws.
 */
export function axisTicks(totalMs: number, count = 4): number[] {
  if (totalMs <= 0) return [0];
  const rough = totalMs / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const nice = [1, 2, 5, 10].map((m) => m * magnitude);
  const step = [...nice].reverse().find((s) => s <= rough) ?? nice[0]!;
  const out: number[] = [];
  for (let t = 0; t <= totalMs; t += step) out.push(Math.round(t));
  return out;
}

export function formatMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  if (value >= 1) return `${Math.round(value)} ms`;
  return `${Math.round(value * 1000)} µs`;
}
