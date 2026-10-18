import "server-only";

/**
 * The read side of the Telemetry tabs (design: V2Telemetry): the services
 * table, the metrics board, and what Atlas established about them.
 *
 * ClickHouse answers for the spans and the metrics (`@openincident/telemetry`,
 * through the tenant guard); PostgreSQL answers for what the workspace knows
 * about those services — who owns them, which incident is open on them, what
 * changed, and what an investigation found. Nothing here is computed from
 * anything but rows.
 */
import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import {
  changeEvents,
  incidents,
  investigations,
  monitors,
  services,
  withTenant,
} from "@openincident/db";
import {
  receiving,
  serviceEdges,
  servicesTable,
  type ServiceTableRow,
} from "@openincident/telemetry";
import { telemetryInstalled } from "@/lib/telemetry";

export const RANGE_MINUTES = { "15m": 15, "1h": 60, "6h": 360, "24h": 1440, "7d": 10080 } as const;
export type RangeKey = keyof typeof RANGE_MINUTES;

export type TelemetrySearch = {
  tab?: string;
  signal?: string;
  range?: string;
  since?: string;
  from?: string;
  to?: string;
  service?: string;
  cmp?: string;
  trace?: string;
  span?: string;
  q?: string;
  status?: string;
  min?: string;
  live?: string;
  crit?: string;
  attached?: string;
  issued?: string;
  rotated?: string;
  fp?: string;
  type?: string;
  compare?: string;
  view?: string;
  session?: string;
  error?: string;
  why?: string;
  new?: string;
};

/** Spans per second over the last five minutes, for the header's "receiving". */
export async function receivingNow(
  tenantId: string,
): Promise<{ perSecond: number; lastAt: Date | null }> {
  if (!telemetryInstalled()) return { perSecond: 0, lastAt: null };
  return receiving(tenantId).catch(() => ({ perSecond: 0, lastAt: null }));
}

export type OpenIncident = { id: string; number: number; service: string; declaredAt: Date };

/** The incidents still open, with the service each is about. */
export async function openIncidents(tenantId: string): Promise<OpenIncident[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: incidents.id,
        number: incidents.number,
        service: services.key,
        declaredAt: incidents.declaredAt,
      })
      .from(incidents)
      .innerJoin(services, eq(services.id, incidents.serviceId))
      .where(
        and(
          eq(incidents.tenantId, tenantId),
          isNull(incidents.resolvedAt),
          isNull(incidents.mergedIntoId),
        ),
      )
      .orderBy(desc(incidents.declaredAt));
    return rows.map((r) => ({ ...r, service: r.service }));
  });
}

export type ServiceBoardRow = ServiceTableRow & {
  owned: boolean;
  /** "INC-220", or "INC-220 (upstream)" when it is a service this one calls. */
  incident: { label: string; upstream: boolean } | null;
};

/**
 * The Services tab: every service that sent a span in the window, with its
 * owner flag and the incident that concerns it — its own, or one open on a
 * service it calls.
 */
export async function servicesBoard(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<ServiceBoardRow[]> {
  const [rows, open, owners] = await Promise.all([
    servicesTable(tenantId, { from, to }),
    openIncidents(tenantId),
    withTenant(tenantId, (tx) =>
      tx
        .select({ key: services.key, owner: services.ownerTeamId })
        .from(services)
        .where(eq(services.tenantId, tenantId)),
    ),
  ]);
  const minutes = Math.max(5, Math.round((to.getTime() - from.getTime()) / 60_000));
  const edges = await serviceEdges(tenantId, { sinceMinutes: Math.max(minutes, 60) }).catch(
    () => [],
  );
  const owned = new Map(owners.map((o) => [o.key, !!o.owner]));
  const byService = new Map<string, OpenIncident>();
  for (const i of open) if (!byService.has(i.service)) byService.set(i.service, i);
  return rows.map((r) => {
    const own = byService.get(r.service);
    let incident: ServiceBoardRow["incident"] = own
      ? { label: `INC-${own.number}`, upstream: false }
      : null;
    if (!incident) {
      const callee = edges
        .filter((e) => e.source_service === r.service && byService.has(e.target_service))
        .map((e) => byService.get(e.target_service)!)[0];
      if (callee) incident = { label: `INC-${callee.number}`, upstream: true };
    }
    return { ...r, owned: owned.get(r.service) ?? false, incident };
  });
}

export type AtlasNote = {
  statement: string;
  source: string;
  incident: number;
};

/**
 * What an investigation established from telemetry about an open incident —
 * the banner over the services and the metrics.
 *
 * Only a finding the analysis made from the telemetry check, citing what it
 * read; no finding, no banner. The source line is the kinds of evidence the
 * finding cites, in the analysis's own words.
 */
export async function atlasNote(tenantId: string, service?: string): Promise<AtlasNote | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        number: incidents.number,
        service: services.key,
        findings: investigations.findings,
        citations: investigations.citations,
      })
      .from(investigations)
      .innerJoin(incidents, eq(incidents.id, investigations.incidentId))
      .leftJoin(services, eq(services.id, incidents.serviceId))
      .where(
        and(
          eq(investigations.tenantId, tenantId),
          isNull(incidents.resolvedAt),
          ...(service ? [eq(services.key, service)] : []),
        ),
      )
      .orderBy(desc(incidents.declaredAt))
      .limit(5);
    for (const r of rows) {
      const finding = r.findings.find((f) => f.check === "telemetry");
      if (!finding) continue;
      const cited = r.citations.filter((c) => finding.citations.includes(c.id));
      const kinds = [...new Set(cited.map((c) => c.kind))];
      return {
        statement: finding.statement,
        source: kinds.length ? kinds.join(" · ") : "telemetry",
        incident: r.number,
      };
    }
    return null;
  });
}

export type Annotations = {
  changes: Array<{ t: number; title: string }>;
  declared: Array<{ t: number; ref: string }>;
  open: Array<{ a: number; b: number; ref: string }>;
};

/** Changes, declarations and open incidents of one service over a window — what a chart marks. */
export async function annotationsFor(
  tenantId: string,
  service: string,
  from: Date,
  to: Date,
): Promise<Annotations> {
  return withTenant(tenantId, async (tx) => {
    const [svc] = await tx
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.tenantId, tenantId), eq(services.key, service)));
    if (!svc) return { changes: [], declared: [], open: [] };
    const [changes, incs] = await Promise.all([
      tx
        .select({ at: changeEvents.occurredAt, title: changeEvents.title })
        .from(changeEvents)
        .where(
          and(
            eq(changeEvents.tenantId, tenantId),
            eq(changeEvents.serviceId, svc.id),
            gte(changeEvents.occurredAt, from),
            lte(changeEvents.occurredAt, to),
          ),
        )
        .limit(12),
      tx
        .select({
          number: incidents.number,
          declaredAt: incidents.declaredAt,
          resolvedAt: incidents.resolvedAt,
        })
        .from(incidents)
        .where(
          and(
            eq(incidents.tenantId, tenantId),
            eq(incidents.serviceId, svc.id),
            isNull(incidents.mergedIntoId),
            lte(incidents.declaredAt, to),
            or(isNull(incidents.resolvedAt), gte(incidents.resolvedAt, from)),
          ),
        )
        .limit(12),
    ]);
    return {
      changes: changes.map((c) => ({ t: c.at.getTime(), title: c.title })),
      declared: incs
        .filter((i) => i.declaredAt >= from)
        .map((i) => ({ t: i.declaredAt.getTime(), ref: `INC-${i.number}` })),
      open: incs.map((i) => ({
        a: i.declaredAt.getTime(),
        b: (i.resolvedAt ?? new Date(to.getTime() + 60_000)).getTime(),
        ref: `INC-${i.number}`,
      })),
    };
  });
}

/**
 * The latency a service is held to, when a monitor says so: the "slower than
 * … → degraded" rule of an HTTP monitor on that service.
 */
export async function latencyThreshold(tenantId: string, service: string): Promise<number | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ criteria: monitors.criteria })
      .from(monitors)
      .innerJoin(services, eq(services.id, monitors.serviceId))
      .where(
        and(
          eq(monitors.tenantId, tenantId),
          eq(services.key, service),
          inArray(monitors.type, ["http", "api"]),
        ),
      );
    for (const r of rows) {
      const c = r.criteria.find(
        (x) =>
          x.on === "response_time_ms" && (x.op === "gt" || x.op === "gte") && x.then === "degraded",
      );
      if (c && Number(c.value) > 0) return Number(c.value);
    }
    return null;
  });
}

/**
 * How many traces match, and at what sampling — the line above the list.
 * The share is the spans' own `sampled_ratio`, so it is what the SDKs sent.
 */
export async function traceCount(
  tenantId: string,
  opts: { from: Date; to: Date; service?: string; filter?: string },
): Promise<{ traces: number; sampled: number }> {
  const { read, compileFilter, chTime, SPANS } = await import("@openincident/telemetry");
  const where = ["s.start_ts >= {fromTs:DateTime64(9)}", "s.start_ts <= {toTs:DateTime64(9)}"];
  const params: Record<string, unknown> = { fromTs: chTime(opts.from), toTs: chTime(opts.to) };
  if (opts.service) {
    where.push("s.service_name = {service:String}");
    params.service = opts.service;
  }
  if (opts.filter?.trim()) {
    const compiled = compileFilter("traces", opts.filter);
    where.push(compiled.sql);
    Object.assign(params, compiled.params);
  }
  const [row] = await read<{ n: string; ratio: number }>(
    tenantId,
    `SELECT toString(uniq(s.trace_id)) AS n, avg(s.sampled_ratio) AS ratio
       FROM ${SPANS} AS s
      WHERE ${where.join(" AND ")}`,
    { params },
  ).catch(() => []);
  return { traces: Number(row?.n ?? 0), sampled: Number(row?.ratio ?? 1) || 1 };
}

/**
 * What an investigation said about one trace: a finding that cites it.
 * Null — and no card — when no analysis ever read this trace.
 */
export async function atlasOnTrace(
  tenantId: string,
  traceId: string,
): Promise<{ statement: string; sources: string[]; incident: number } | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        number: incidents.number,
        findings: investigations.findings,
        citations: investigations.citations,
      })
      .from(investigations)
      .innerJoin(incidents, eq(incidents.id, investigations.incidentId))
      .where(eq(investigations.tenantId, tenantId))
      .orderBy(desc(incidents.declaredAt))
      .limit(30);
    for (const r of rows) {
      const cites = r.citations.filter((c) => (c.url ?? "").includes(traceId));
      if (cites.length === 0) continue;
      const ids = new Set(cites.map((c) => c.id));
      const finding = r.findings.find((f) => f.citations.some((id) => ids.has(id)));
      if (!finding) continue;
      return {
        statement: finding.statement,
        sources: r.citations.filter((c) => finding.citations.includes(c.id)).map((c) => c.label),
        incident: r.number,
      };
    }
    return null;
  });
}

/**
 * The query box of the Logs tab, as the filter language reads it.
 *
 * `service:x` and `level:error|warn|info` are the two keys the design's box
 * shows; `trace:` narrows to one trace; every other word is searched in the
 * body. Values travel as bound parameters through the filter compiler.
 */
export function parseLogQuery(q: string): {
  service?: string;
  traceId?: string;
  filter?: string;
} {
  const out: { service?: string; traceId?: string; filter?: string } = {};
  const parts: string[] = [];
  for (const raw of q.trim().split(/\s+/).filter(Boolean)) {
    const word = raw.replace(/['"\\]/g, "");
    const [key, ...rest] = word.split(":");
    const value = rest.join(":");
    if (key === "service" && value) out.service = value;
    else if (key === "trace" && value) out.traceId = value;
    else if (key === "level" && value) {
      const level = value.toLowerCase();
      if (level === "error") parts.push("severity_number >= 17");
      else if (level === "warn" || level === "warning")
        parts.push("severity_number >= 13 AND severity_number < 17");
      else if (level === "info") parts.push("severity_number < 13");
    } else if (word) parts.push(`body contains '${word}'`);
  }
  if (parts.length) out.filter = parts.join(" AND ");
  return out;
}

/** How many lines match in the window, and how many arrived in the last five minutes. */
export async function logCounts(
  tenantId: string,
  opts: {
    from: Date;
    to: Date;
    service?: string;
    filter?: string;
    traceId?: string;
    spanId?: string;
  },
): Promise<{ total: number; perMinute: number }> {
  const { read, compileFilter, chTime, LOGS } = await import("@openincident/telemetry");
  const where = ["l.ts >= {fromTs:DateTime64(9)}", "l.ts <= {toTs:DateTime64(9)}"];
  const params: Record<string, unknown> = { fromTs: chTime(opts.from), toTs: chTime(opts.to) };
  if (opts.service) {
    where.push("l.service_name = {service:String}");
    params.service = opts.service;
  }
  if (opts.traceId) {
    where.push("l.trace_id = {traceId:String}");
    params.traceId = opts.traceId;
  }
  if (opts.spanId) {
    where.push("l.span_id = {spanId:String}");
    params.spanId = opts.spanId;
  }
  if (opts.filter?.trim()) {
    const compiled = compileFilter("logs", opts.filter);
    where.push(compiled.sql);
    Object.assign(params, compiled.params);
  }
  const [row] = await read<{ n: string; recent: string }>(
    tenantId,
    `SELECT toString(count()) AS n,
            toString(countIf(l.ts >= now() - INTERVAL 5 MINUTE)) AS recent
       FROM ${LOGS} AS l
      WHERE ${where.join(" AND ")}`,
    { params },
  ).catch(() => []);
  return { total: Number(row?.n ?? 0), perMinute: Number(row?.recent ?? 0) / 5 };
}
