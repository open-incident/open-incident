import { and, desc, eq, gte, lt } from "drizzle-orm";
import { alertPriorities, alertSources, alerts, withTenant } from "@openincident/db";
import { apiAuth, apiError, apiJson } from "@/lib/api";
import { serialiseAlert } from "@/lib/api-serialise";

export const dynamic = "force-dynamic";

/**
 * Two, not four.
 *
 * An alert is firing or it is resolved; acknowledged and snoozed are states of
 * the *escalation* that followed it, carried here as `acked_at` and
 * `snoozed_until` rather than as statuses. Offering four would invite a filter
 * that silently matches nothing.
 */
const STATUSES = ["firing", "resolved"] as const;

/**
 * GET /api/v1/alerts?status=open&since=ISO&limit=100 — the noise, as it arrived.
 *
 * Alerts, not incidents. The distinction is the whole design of this product:
 * hundreds of alerts fire, a handful become incidents, and conflating them is
 * how a tool ends up paging somebody for a disk that is 81 % full. Read
 * `/incidents` for the things people are working on.
 */
export async function GET(request: Request) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);

  const status = url.searchParams.get("status");
  if (status && !(STATUSES as readonly string[]).includes(status))
    return apiError(422, "invalid_status", `Unknown status "${status}".`);
  const since = url.searchParams.get("since");
  const sinceDate = since ? new Date(since) : null;
  if (sinceDate && Number.isNaN(sinceDate.getTime()))
    return apiError(422, "invalid_body", "`since` must be an ISO 8601 timestamp.");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 200);
  const cursor = url.searchParams.get("cursor");
  const cursorDate = cursor ? new Date(cursor) : null;

  const tenantId = auth.ctx.tenant.id;
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: alerts.id,
        title: alerts.title,
        description: alerts.description,
        status: alerts.status,
        urgency: alerts.urgency,
        snoozedUntil: alerts.snoozedUntil,
        dedupKey: alerts.dedupKey,
        groupCount: alerts.groupCount,
        incidentId: alerts.incidentId,
        externalUrl: alerts.externalUrl,
        testMode: alerts.testMode,
        firstAt: alerts.firstAt,
        lastAt: alerts.lastAt,
        ackedAt: alerts.ackedAt,
        resolvedAt: alerts.resolvedAt,
        source: alertSources.name,
        priority: alertPriorities.name,
      })
      .from(alerts)
      .leftJoin(alertSources, eq(alertSources.id, alerts.sourceId))
      .leftJoin(alertPriorities, eq(alertPriorities.id, alerts.priorityId))
      .where(
        and(
          eq(alerts.tenantId, tenantId),
          ...(status ? [eq(alerts.status, status as (typeof STATUSES)[number])] : []),
          ...(sinceDate ? [gte(alerts.lastAt, sinceDate)] : []),
          ...(cursorDate ? [lt(alerts.lastAt, cursorDate)] : []),
        ),
      )
      .orderBy(desc(alerts.lastAt))
      .limit(limit),
  );

  return apiJson({
    data: rows.map(serialiseAlert),
    // The cursor is the last row's timestamp rather than an opaque token: the
    // ordering key is the timestamp, so anything else would be that value in a
    // costume.
    next_cursor:
      rows.length === limit ? (rows[rows.length - 1]?.lastAt.toISOString() ?? null) : null,
  });
}
