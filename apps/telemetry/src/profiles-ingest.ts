/**
 * Writing a profile's samples, and the stacks they point at.
 *
 * Two tables, for the reason the schema gives: the same few hundred call paths
 * repeat thousands of times a minute, and carrying their frames beside every
 * sample would make the store an order of magnitude larger than the
 * information in it. The stack table is a `ReplacingMergeTree`, so writing a
 * stack that is already there costs a row that the next merge collapses.
 *
 * A pprof upload is not one profile. A Go heap profile carries four kinds and
 * a CPU profile two, so what arrives here is a list — each written under its
 * own `profile_type`, which is what lets the screen offer a picker rather than
 * whatever the last upload happened to contain.
 */
import { clickhouse } from "@openincident/telemetry";
import type { Caller } from "./auth";
import { resolveServices, type Outcome } from "./ingest";
import { retentionAt, scrubAttributes, type Settings } from "./shared";
import { stackId, type ProfileDecode } from "./pprof";

export type ProfileUpload = {
  serviceName: string;
  environment: string;
  release: string;
  /** Extra labels from the upload itself — a Pyroscope name carries some. */
  labels: Record<string, string>;
};

export async function ingestProfiles(
  caller: Caller,
  settings: Settings,
  upload: ProfileUpload,
  decoded: ProfileDecode[],
): Promise<Outcome> {
  const out: Outcome = { accepted: 0, rejected: [] };
  const service = caller.pinnedServiceName ?? upload.serviceName;
  if (!service) {
    out.rejected.push({ reason: "missing service.name", excerpt: "" });
    return out;
  }
  if (decoded.length === 0) return out;

  const until = retentionAt(settings.retentionProfilesDays);
  const ids = await resolveServices(caller, [{ name: service, ra: {} }]);
  const serviceId = ids.get(service)!;
  const ch = clickhouse();

  // One row per distinct stack across every kind in this upload: the four
  // columns of a heap profile share their call paths exactly.
  const stacks = new Map<string, string[]>();
  const rows: Array<Record<string, unknown>> = [];

  for (const profile of decoded) {
    // The profile's own clock when it has one. A profiler that says nothing is
    // taken to mean now, which is true for a push and close enough for a
    // scrape; inventing a timestamp from the upload's arrival would be the
    // only alternative and is the same thing said less honestly.
    const ts = profile.timeNanos > 0 ? new Date(profile.timeNanos / 1e6) : new Date();
    const at = ts.toISOString().replace("T", " ").replace("Z", "");

    for (const sample of profile.samples) {
      const id = stackId(sample.frames);
      if (!stacks.has(id)) stacks.set(id, sample.frames);
      rows.push({
        tenant_id: caller.tenantId,
        service_id: serviceId,
        service_name: service,
        environment: upload.environment,
        release: upload.release,
        ts: at,
        profile_type: profile.type,
        sample_unit: profile.unit,
        period_ns: profile.periodNs,
        stack_id: id,
        value: sample.value,
        // A profiler's own labels can carry anything the application put in a
        // span tag, so they go through the same scrub as everything else.
        labels: scrubAttributes({ ...upload.labels, ...sample.labels }, settings.scrubRules),
        retention_at: until,
      });
    }
  }

  if (rows.length === 0) return out;

  // The stacks first: a sample whose stack is unknown is a flamegraph block
  // with no name, and the read joins the two.
  await ch.insert({
    table: "profile_stacks",
    format: "JSONEachRow",
    values: [...stacks].map(([id, frames]) => ({
      tenant_id: caller.tenantId,
      stack_id: id,
      frames,
      symbolized: decoded[0]!.symbolized,
      retention_at: until,
    })),
  });
  await ch.insert({ table: "otel_profiles", format: "JSONEachRow", values: rows });

  out.accepted = rows.length;
  return out;
}

/**
 * A Pyroscope application name into a service and its labels.
 *
 * Agents send `checkout-api.cpu{env=prod,region=eu}` in a query parameter, and
 * that one string is the service, the profile kind and a label set. Reading it
 * is what lets an existing Pyroscope or Grafana Alloy agent point here with one
 * line changed.
 */
export function parsePyroscopeName(name: string): {
  service: string;
  type: string | undefined;
  labels: Record<string, string>;
} {
  const labels: Record<string, string> = {};
  const brace = name.indexOf("{");
  const head = brace >= 0 ? name.slice(0, brace) : name;
  if (brace >= 0) {
    for (const pair of name
      .slice(brace + 1)
      .replace(/}\s*$/, "")
      .split(",")) {
      const at = pair.indexOf("=");
      if (at <= 0) continue;
      labels[pair.slice(0, at).trim()] = pair
        .slice(at + 1)
        .trim()
        .replace(/^"|"$/g, "");
    }
  }
  // The suffix after the last dot is the kind, when it is one we know. A
  // service genuinely called `payments.api` keeps its name: guessing wrong
  // here would file every profile under a service that does not exist.
  const dot = head.lastIndexOf(".");
  const suffix = dot > 0 ? head.slice(dot + 1) : "";
  const known =
    /^(cpu|wall|alloc_space|alloc_objects|inuse_space|inuse_objects|goroutines|mutex|block|itimer|samples)$/;
  if (dot > 0 && known.test(suffix)) {
    return { service: head.slice(0, dot), type: suffix, labels };
  }
  return { service: head, type: undefined, labels };
}
