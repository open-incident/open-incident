/**
 * From decoded signal to rows in ClickHouse — scrubbed, enriched, retained.
 *
 * The order of the four steps is the order of §15.4, and each one is there for
 * a reason that bit somebody once:
 *
 *  - **validate** before anything else, so a payload without `service.name`
 *    becomes a rejection somebody can read rather than a pile of rows under
 *    `unknown_service`;
 *  - **scrub** before writing, never at read time — a secret redacted on
 *    display has already been stored;
 *  - **enrich** by resolving the service, which is how a service appears in
 *    the product the first time a trace names it (D18) without anybody filling
 *    a form;
 *  - **compute retention per row**, because changing a workspace's retention
 *    must act on what arrives next without rewriting what is already there.
 */
import { and, eq, sql } from "drizzle-orm";
import { services, withTenant, type Tx } from "@openincident/db";
import { clickhouse } from "@openincident/telemetry";
import type { Caller } from "./auth";
import { fromLogs, fromSpans, writeExceptions } from "./exceptions-ingest";
import type { DecodedLog, DecodedSpan } from "./otlp";
import { retentionAt, scrub, scrubAttributes, settingsFor, type Settings } from "./shared";

export { retentionAt, scrub, scrubAttributes, settingsFor, type Settings };

/**
 * The service a signal names, created the first time it is named.
 *
 * This is the sentence that replaced the catalog: nobody describes their
 * estate before the first page, so the estate describes itself. Ownership is
 * the one thing a human still adds, and it survives because the row is
 * upserted, never recreated.
 */
async function serviceIdFor(tx: Tx, tenantId: string, name: string, stack: string | null) {
  const now = new Date();
  const [row] = await tx
    .insert(services)
    .values({
      tenantId,
      key: name,
      seenIn: ["telemetry"],
      telemetryFirstSeenAt: now,
      telemetryLastSeenAt: now,
      techStack: stack,
    })
    .onConflictDoUpdate({
      target: [services.tenantId, services.key],
      set: {
        telemetryLastSeenAt: now,
        // `now()` rather than a bound Date: postgres.js will not bind a Date
        // inside a raw fragment, and `jsonb_exists` rather than the `?`
        // operator, which collides with the driver's own placeholder syntax.
        telemetryFirstSeenAt: sql`coalesce(${services.telemetryFirstSeenAt}, now())`,
        seenIn: sql`case when jsonb_exists(${services.seenIn}, 'telemetry')
                         then ${services.seenIn}
                         else ${services.seenIn} || '["telemetry"]'::jsonb end`,
        techStack: sql`coalesce(${services.techStack}, ${stack ?? null})`,
        updatedAt: now,
      },
    })
    .returning({ id: services.id });
  if (row) return row.id;
  const [existing] = await tx
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.tenantId, tenantId), eq(services.key, name)));
  return existing!.id;
}

export type Outcome = { accepted: number; rejected: Array<{ reason: string; excerpt: string }> };

export async function ingestLogs(
  caller: Caller,
  settings: Settings,
  decoded: DecodedLog[],
): Promise<Outcome> {
  const out: Outcome = { accepted: 0, rejected: [] };
  const usable = decoded.filter((l) => {
    const name = caller.pinnedServiceName ?? l.serviceName;
    if (name) return true;
    out.rejected.push({
      reason: "missing service.name",
      excerpt: scrub(l.body.slice(0, 200), settings.scrubRules),
    });
    return false;
  });
  if (usable.length === 0) return out;

  const until = retentionAt(settings.retentionLogsDays);
  const ids = await resolveServices(
    caller,
    usable.map((l) => ({
      name: caller.pinnedServiceName ?? l.serviceName,
      ra: l.resourceAttributes,
    })),
  );

  // Exceptions come out of the same batch, before the rows go in: a stack
  // trace is a log AND an exception, and the screen needs both.
  await writeExceptions(
    caller,
    settings,
    fromLogs(usable, (n) => ids.get(n)!, caller.pinnedServiceName),
  );

  await clickhouse().insert({
    table: "otel_logs",
    format: "JSONEachRow",
    values: usable.map((l) => {
      const name = caller.pinnedServiceName ?? l.serviceName;
      return {
        tenant_id: caller.tenantId,
        service_id: ids.get(name)!,
        service_name: name,
        environment: l.environment,
        ts: l.ts,
        observed_ts: l.observedTs,
        severity_number: l.severityNumber,
        severity_text: l.severityText,
        body: scrub(l.body, settings.scrubRules),
        trace_id: l.traceId,
        span_id: l.spanId,
        scope_name: l.scopeName,
        attributes: scrubAttributes(l.attributes, settings.scrubRules),
        resource_attributes: scrubAttributes(l.resourceAttributes, settings.scrubRules),
        retention_at: until,
      };
    }),
  });
  out.accepted = usable.length;
  return out;
}

export async function ingestSpans(
  caller: Caller,
  settings: Settings,
  decoded: DecodedSpan[],
): Promise<Outcome> {
  const out: Outcome = { accepted: 0, rejected: [] };
  const usable = decoded.filter((s) => {
    const name = caller.pinnedServiceName ?? s.serviceName;
    if (!name) {
      out.rejected.push({ reason: "missing service.name", excerpt: s.name.slice(0, 200) });
      return false;
    }
    if (!s.traceId || !s.spanId) {
      out.rejected.push({
        reason: "span without trace_id or span_id",
        excerpt: s.name.slice(0, 200),
      });
      return false;
    }
    return true;
  });
  if (usable.length === 0) return out;

  const until = retentionAt(settings.retentionTracesDays);
  const ids = await resolveServices(
    caller,
    usable.map((s) => ({
      name: caller.pinnedServiceName ?? s.serviceName,
      ra: s.resourceAttributes,
    })),
  );

  await writeExceptions(
    caller,
    settings,
    fromSpans(usable, (n) => ids.get(n)!, caller.pinnedServiceName),
  );

  await clickhouse().insert({
    table: "otel_spans",
    format: "JSONEachRow",
    values: usable.map((s) => {
      const name = caller.pinnedServiceName ?? s.serviceName;
      return {
        tenant_id: caller.tenantId,
        service_id: ids.get(name)!,
        service_name: name,
        environment: s.environment,
        service_version: s.serviceVersion,
        start_ts: s.startTs,
        end_ts: s.endTs,
        duration_ns: s.durationNs,
        trace_id: s.traceId,
        span_id: s.spanId,
        parent_span_id: s.parentSpanId,
        name: s.name,
        kind: s.kind,
        status_code: s.statusCode,
        status_message: scrub(s.statusMessage, settings.scrubRules),
        http_method: s.httpMethod,
        http_route: s.httpRoute,
        http_status_code: s.httpStatusCode,
        db_system: s.dbSystem,
        rpc_service: s.rpcService,
        peer_service: s.peerService,
        attributes: scrubAttributes(s.attributes, settings.scrubRules),
        resource_attributes: scrubAttributes(s.resourceAttributes, settings.scrubRules),
        events: [],
        links: [],
        has_exception: s.hasException,
        sampled_ratio: 1,
        retention_at: until,
      };
    }),
  });
  out.accepted = usable.length;
  return out;
}

/** One upsert per distinct service in the batch, not one per row. */
export async function resolveServices(
  caller: Caller,
  refs: Array<{ name: string; ra: Record<string, string> }>,
): Promise<Map<string, string>> {
  const distinct = new Map<string, string | null>();
  for (const r of refs) {
    if (!distinct.has(r.name)) distinct.set(r.name, r.ra["telemetry.sdk.language"] ?? null);
  }
  return withTenant(caller.tenantId, async (tx) => {
    const ids = new Map<string, string>();
    for (const [name, stack] of distinct) {
      ids.set(name, await serviceIdFor(tx, caller.tenantId, name, stack));
    }
    return ids;
  });
}
