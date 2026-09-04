"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { escalationPathVersions, escalationPaths, incidents, withTenant } from "@openincident/db";
import { previewGraph, startEscalation } from "@openincident/oncall";
import { requireResponder } from "@/lib/session";

/** "Who will be paged": the levels of the path resolved right now, before confirming. */
export async function previewEscalation(pathId: string): Promise<
  Array<{
    level: number;
    offsetMinutes: number;
    members: string[];
    urgency: string;
    ackTimeoutMinutes: number;
    retries: number;
  }>
> {
  const current = await requireResponder();
  const id = z.string().uuid().parse(pathId);
  return withTenant(current.tenant.id, async (tx) => {
    const [p] = await tx
      .select()
      .from(escalationPaths)
      .where(and(eq(escalationPaths.tenantId, current.tenant.id), eq(escalationPaths.id, id)));
    if (!p?.currentVersionId) return [];
    const [v] = await tx
      .select({ graph: escalationPathVersions.graph })
      .from(escalationPathVersions)
      .where(eq(escalationPathVersions.id, p.currentVersionId));
    if (!v) return [];
    const levels = await previewGraph(tx, current.tenant.id, v.graph, {
      now: new Date(),
      urgency: "high",
      priorityRank: 0,
    });
    return levels.map((l) => ({
      level: l.level,
      offsetMinutes: l.offsetMinutes,
      members: l.members.map((m) => m.name),
      urgency: l.urgency,
      ackTimeoutMinutes: l.ackTimeoutMinutes,
      retries: l.retries,
    }));
  });
}

/** Escalates the incident on a path: a real escalation, traced in the timeline, that pages people now. */
export async function escalateIncident(formData: FormData): Promise<{ ok: boolean }> {
  const current = await requireResponder();
  const number = z.coerce.number().int().positive().parse(formData.get("number"));
  const pathId = z.string().uuid().parse(formData.get("pathId"));
  const [inc] = await withTenant(current.tenant.id, (tx) =>
    tx
      .select({ id: incidents.id, phase: incidents.phase })
      .from(incidents)
      .where(and(eq(incidents.tenantId, current.tenant.id), eq(incidents.number, number))),
  );
  if (!inc || inc.phase === "closed") return { ok: false };
  const started = await startEscalation(current.tenant.id, {
    pathId,
    incidentId: inc.id,
    urgency: "high",
    priorityRank: 0,
    triggeredBy: { kind: "member", memberId: current.member.id, name: current.member.name },
  });
  revalidatePath(`/app/incidents/${number}`);
  return { ok: Boolean(started) };
}
