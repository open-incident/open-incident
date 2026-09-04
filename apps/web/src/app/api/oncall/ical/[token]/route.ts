/** GET /api/oncall/ical/{token}.ics — the schedule's shifts for the next 60 days, for any calendar app. */
import { and, eq, inArray } from "drizzle-orm";
import { members, rotations, scheduleOverrides, schedules, withTenant } from "@openincident/db";
import { scheduleToIcs, shiftsBetween } from "@openincident/oncall";
import { getTenantFromHeaders, requestOrigin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/\.ics$/, "");
  const tenant = await getTenantFromHeaders();
  if (!tenant || !/^[a-f0-9]{32}$/.test(token)) return new Response("Not found", { status: 404 });
  const ics = await withTenant(tenant.id, async (tx) => {
    const [s] = await tx
      .select()
      .from(schedules)
      .where(and(eq(schedules.tenantId, tenant.id), eq(schedules.icalToken, token)));
    if (!s) return null;
    const rots = await tx.select().from(rotations).where(eq(rotations.scheduleId, s.id));
    const ovs = await tx
      .select()
      .from(scheduleOverrides)
      .where(eq(scheduleOverrides.scheduleId, s.id));
    const ids = [
      ...new Set([
        ...rots.flatMap((r) => r.memberIds),
        ...ovs.map((o) => o.memberId).filter((x): x is string => Boolean(x)),
      ]),
    ];
    const people = ids.length
      ? await tx
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(inArray(members.id, ids))
      : [];
    const from = new Date(Date.now() - 7 * 86_400_000);
    const to = new Date(Date.now() + 60 * 86_400_000);
    const shifts = rots.flatMap((r) => shiftsBetween(s, r, ovs, from, to));
    const origin = requestOrigin({ headers: request.headers, nextUrl: new URL(request.url) });
    return scheduleToIcs({
      name: s.name,
      workspace: tenant.slug,
      shifts,
      nameOf: (id) => (id ? (people.find((p) => p.id === id)?.name ?? "—") : "nobody"),
      url: `${origin}/app/on-call?schedule=${s.id}`,
    });
  });
  if (!ics) return new Response("Not found", { status: 404 });
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="on-call.ics"`,
    },
  });
}
