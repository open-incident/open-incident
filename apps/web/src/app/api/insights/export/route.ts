/** GET /api/insights/export?tab=incidents|alerts|pager|followups&days=90 — the rows behind the numbers, as CSV. */
import { withTenant } from "@openincident/db";
import { isManagerRole } from "@openincident/config";
import { getPayReport } from "@/lib/pay";
import { currentMember } from "@/lib/session";
import {
  alertInsights,
  followUpInsights,
  incidentInsights,
  pagerInsights,
  periodOf,
  toCsv,
} from "@/lib/insights";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const current = await currentMember();
  if (!current) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") ?? "incidents";
  const daysRaw = Number(url.searchParams.get("days") ?? 90);
  const days = daysRaw === 30 || daysRaw === 365 ? daysRaw : 90;
  const period = periodOf(days);
  if (tab === "pay") {
    const period = url.searchParams.get("period") ?? "";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return new Response("Bad period", { status: 400 });
    const report = await withTenant(current.tenant.id, (tx) =>
      getPayReport(tx, current.tenant.id, period),
    );
    if (!report) return new Response("Not found", { status: 404 });
    const manages = isManagerRole(current.member);
    if (!manages && report.status !== "published")
      return new Response("Not found", { status: 404 });
    const rows = (
      manages ? report.rows : report.rows.filter((r) => r.memberId === current.member.id)
    ).map((r) => ({
      period,
      member: r.memberName,
      schedule: r.scheduleName,
      standby_hours: r.minutes.standby / 60,
      night_hours: r.minutes.night / 60,
      weekend_hours: r.minutes.weekend / 60,
      holiday_hours: r.minutes.holiday / 60,
      amount: (r.amountCents / 100).toFixed(2),
      currency: report.currency,
      status: report.status,
    }));
    return new Response(toCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="open-incident-pay-${period}.csv"`,
      },
    });
  }
  const rows = await withTenant(current.tenant.id, async (tx) => {
    if (tab === "alerts") return (await alertInsights(tx, current.tenant.id, period)).rows;
    if (tab === "pager")
      return (await pagerInsights(tx, current.tenant.id, period, current.workspace.timezone)).rows;
    if (tab === "followups") return (await followUpInsights(tx, current.tenant.id, period)).rows;
    return (await incidentInsights(tx, current.tenant.id, period)).rows;
  });
  return new Response(toCsv(rows as Array<Record<string, unknown>>), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="open-incident-${tab}-${days}d.csv"`,
    },
  });
}
