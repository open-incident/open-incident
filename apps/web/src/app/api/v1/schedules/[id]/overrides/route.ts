import { and, asc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { members, rotations, scheduleOverrides, schedules, withTenant } from "@openincident/db";
import { apiAuth, apiError, apiJson, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/schedules/{id}/overrides — covers in force or still to come. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiAuth(request, "read");
  if (!auth.ok) return auth.response;
  const tenantId = auth.ctx.tenant.id;
  const { id } = await params;

  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: scheduleOverrides.id,
        rotationId: scheduleOverrides.rotationId,
        memberId: scheduleOverrides.memberId,
        startAt: scheduleOverrides.startAt,
        endAt: scheduleOverrides.endAt,
        reason: scheduleOverrides.reason,
        name: members.name,
        email: members.email,
      })
      .from(scheduleOverrides)
      .leftJoin(members, eq(members.id, scheduleOverrides.memberId))
      .where(
        and(
          eq(scheduleOverrides.tenantId, tenantId),
          eq(scheduleOverrides.scheduleId, id),
          gte(scheduleOverrides.endAt, new Date()),
        ),
      )
      .orderBy(asc(scheduleOverrides.startAt)),
  );

  return apiJson({
    data: rows.map((o) => ({
      id: o.id,
      rotation_id: o.rotationId,
      member_id: o.memberId,
      name: o.name,
      email: o.email,
      start_at: o.startAt.toISOString(),
      end_at: o.endAt.toISOString(),
      reason: o.reason,
    })),
  });
}

const schema = z.object({
  rotation_id: z.string().uuid(),
  /** The member taking the shift, by id or by email — a script rarely holds a uuid. */
  member: z.string().trim().min(1).max(320),
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),
  /**
   * Why, in the product's own two words rather than free text. `cover` is
   * somebody standing in for the person whose turn it is; `override` is a
   * shift replaced outright. The distinction is what the pay report and the
   * coverage screen count differently, so it cannot be a sentence.
   */
  reason: z.enum(["override", "cover"]).default("override"),
});

/**
 * POST /api/v1/schedules/{id}/overrides (scope write) — put somebody else on.
 *
 * The one write the on-call model really needs from an API. Everything else
 * about a rota is a decision somebody makes once and lives with; a cover is a
 * decision made at eight in the morning because a person is ill, and it is
 * exactly the kind of thing a workflow tool should be able to do.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiAuth(request, "write");
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.body);
  if (!parsed.success)
    return apiError(
      422,
      "invalid_body",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  const input = parsed.data;
  const start = new Date(input.start_at);
  const end = new Date(input.end_at);
  if (end <= start) return apiError(422, "invalid_body", "`end_at` must be after `start_at`.");

  const tenantId = auth.ctx.tenant.id;
  const { id } = await params;

  const outcome = await withTenant(tenantId, async (tx) => {
    const [schedule] = await tx
      .select({ id: schedules.id })
      .from(schedules)
      .where(and(eq(schedules.tenantId, tenantId), eq(schedules.id, id)))
      .limit(1);
    if (!schedule) return { code: "not_found" as const, what: `schedule "${id}"` };

    const [rotation] = await tx
      .select({ id: rotations.id })
      .from(rotations)
      .where(
        and(
          eq(rotations.tenantId, tenantId),
          eq(rotations.id, input.rotation_id),
          // A rotation of another schedule would be accepted by the foreign key
          // and would then never fire: the override is read per schedule.
          eq(rotations.scheduleId, schedule.id),
        ),
      )
      .limit(1);
    if (!rotation)
      return { code: "unknown_rotation" as const, what: `rotation "${input.rotation_id}"` };

    const [person] = await tx
      .select({ id: members.id, name: members.name, email: members.email })
      .from(members)
      .where(
        and(
          eq(members.tenantId, tenantId),
          input.member.includes("@")
            ? eq(members.email, input.member.toLowerCase())
            : eq(members.id, input.member),
        ),
      )
      .limit(1);
    if (!person) return { code: "unknown_member" as const, what: `member "${input.member}"` };

    const [row] = await tx
      .insert(scheduleOverrides)
      .values({
        tenantId,
        scheduleId: schedule.id,
        rotationId: rotation.id,
        memberId: person.id,
        startAt: start,
        endAt: end,
        reason: input.reason,
      })
      .returning();
    return { code: "ok" as const, row: row!, person };
  });

  if (outcome.code === "not_found")
    return apiError(404, "not_found", `No ${outcome.what} in this workspace.`);
  if (outcome.code !== "ok")
    return apiError(422, outcome.code, `No ${outcome.what} in this workspace.`);

  return apiJson(
    {
      id: outcome.row.id,
      rotation_id: outcome.row.rotationId,
      member_id: outcome.row.memberId,
      name: outcome.person.name,
      start_at: outcome.row.startAt.toISOString(),
      end_at: outcome.row.endAt.toISOString(),
      reason: outcome.row.reason,
    },
    201,
  );
}
