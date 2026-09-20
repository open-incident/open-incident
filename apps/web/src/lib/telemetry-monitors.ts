import "server-only";

/**
 * Whether a telemetry monitor's query would run, checked before it is stored.
 *
 * A monitor whose query does not compile is worse than no monitor: it exists,
 * it appears on the screen, and it fails silently every minute for as long as
 * nobody reads the worker's log. Compiling it at creation turns that into a
 * sentence in front of the person who wrote it, while they still remember what
 * they meant.
 *
 * The compilers are the real ones — the filter compiler the evaluator uses and
 * the PromQL parser the dashboards use — so what passes here is exactly what
 * will run. Returns the reason, or null when the query is good.
 */
import {
  TelemetryMonitorError,
  compileFilter,
  parsePromql,
  PromqlError,
  type TelemetryMonitorKind,
} from "@openincident/telemetry";
import type { TelemetryQuery } from "@openincident/db";

export function telemetryQueryError(type: string, q: TelemetryQuery): string | null {
  const kind = type as TelemetryMonitorKind;
  try {
    if (kind === "metrics") parsePromql(q.query);
    else compileFilter(kind, q.query);
  } catch (err) {
    if (err instanceof TelemetryMonitorError || err instanceof PromqlError) return err.message;
    throw err;
  }
  if (q.aggregate !== "count" && q.aggregate !== "rate" && kind !== "metrics" && !q.field) {
    return `${q.aggregate} needs a field to run on`;
  }
  return null;
}
