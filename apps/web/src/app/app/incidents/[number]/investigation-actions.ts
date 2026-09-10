"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { incidents, investigations, postMortems, withTenant } from "@openincident/db";
import { ensureInvestigationRow } from "@openincident/investigations";
import { getT } from "@/i18n/server";
import { requireResponder } from "@/lib/session";
import { requestAssessment } from "@/lib/investigations";

const numberSchema = z.coerce.number().int().positive();

const actorOf = (c: Awaited<ReturnType<typeof requireResponder>>) => ({
  kind: "member" as const,
  memberId: c.member.id,
  name: c.member.name,
});

async function incidentId(tenantId: string, number: number): Promise<string | null> {
  const [inc] = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number))),
  );
  return inc?.id ?? null;
}

/** "Start the analysis" / "Re-assess" — a person's request, attributed to them. */
export async function rerunInvestigation(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const id = await incidentId(current.tenant.id, number);
  if (id) await requestAssessment(current.tenant, id, "manual", actorOf(current));
  revalidatePath(`/app/incidents/${number}`);
}

/** Paused: signals stop re-assessing; a person can still ask. Resumed: they do again. */
export async function toggleInvestigationPause(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const paused = formData.get("paused") === "1";
  const id = await incidentId(current.tenant.id, number);
  if (id) {
    const row = await ensureInvestigationRowQuiet(current.tenant.id, id);
    if (row)
      await withTenant(current.tenant.id, (tx) =>
        tx
          .update(investigations)
          .set({ paused, updatedAt: new Date() })
          .where(eq(investigations.id, row.id)),
      );
  }
  revalidatePath(`/app/incidents/${number}`);
}

/** The row without touching its status — for settings that are not a request. */
async function ensureInvestigationRowQuiet(tenantId: string, incidentId: string) {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select().from(investigations).where(eq(investigations.incidentId, incidentId)),
  );
  return row ?? null;
}

/** What a responder knows becomes cited evidence, and the analysis runs again with it. */
export async function addInvestigationNote(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const body = z.string().trim().min(3).max(2000).parse(formData.get("body"));
  const id = await incidentId(current.tenant.id, number);
  if (!id) return;
  const row = await ensureInvestigationRow(current.tenant.id, id, "note");
  const note = {
    id: crypto.randomUUID(),
    memberId: current.member.id,
    memberName: current.member.name,
    body,
    at: new Date().toISOString(),
  };
  await withTenant(current.tenant.id, (tx) =>
    tx
      .update(investigations)
      .set({ notes: [...row.notes, note], updatedAt: new Date() })
      .where(eq(investigations.id, row.id)),
  );
  await requestAssessment(current.tenant, id, "note", actorOf(current));
  revalidatePath(`/app/incidents/${number}`);
}

/** Once the post-mortem names the cause: how close the analysis came, in a person's judgement. */
export async function gradeInvestigation(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const grade = z
    .enum(["bullseye", "on_target", "miss", "nowhere_near"])
    .parse(formData.get("grade"));
  const gradeNote = z
    .string()
    .trim()
    .max(1000)
    .parse(formData.get("note") ?? "");
  const id = await incidentId(current.tenant.id, number);
  if (id)
    await withTenant(current.tenant.id, (tx) =>
      tx
        .update(investigations)
        .set({
          grade,
          gradeNote: gradeNote || null,
          gradedByMemberId: current.member.id,
          gradedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(investigations.incidentId, id)),
    );
  revalidatePath(`/app/incidents/${number}`);
}

/**
 * The surest surviving hypothesis becomes the post-mortem's RCA section — as an
 * AI draft, only when that section is still empty. The person edits from there.
 */
export async function investigationToPostMortem(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const tenantId = current.tenant.id;
  const id = await incidentId(tenantId, number);
  if (!id) return;
  const t = await getT();
  const keys = ["summary", "impact", "timeline", "root_cause", "went_well", "improve"] as const;
  await withTenant(tenantId, async (tx) => {
    const [inv] = await tx.select().from(investigations).where(eq(investigations.incidentId, id));
    const top = inv?.hypotheses.find((h) => h.id === inv.summary?.topHypothesisId);
    if (!inv || !top) return;
    const findings = inv.findings.filter((f) => top.findings.includes(f.id));
    const body = [
      `${top.whatBroke}`,
      "",
      top.why,
      "",
      ...findings.map((f) => `- ${f.statement} (${f.citations.join(", ")})`),
      "",
      `${t("ai.investigation.confidenceLabel")}: ${t(`ai.investigation.confidence.${top.confidence}`)}`,
    ].join("\n");
    const [pm] = await tx.select().from(postMortems).where(eq(postMortems.incidentId, id));
    if (pm) {
      const existing = pm.sections.find((s) => s.key === "root_cause");
      if (existing?.body.trim()) return;
      const sections = existing
        ? pm.sections.map((s) => (s.key === "root_cause" ? { ...s, body } : s))
        : [...pm.sections, { key: "root_cause", title: t("postMortem.section.root_cause"), body }];
      await tx
        .update(postMortems)
        .set({ sections, aiDrafted: true, updatedAt: new Date() })
        .where(eq(postMortems.id, pm.id));
    } else {
      await tx.insert(postMortems).values({
        tenantId,
        incidentId: id,
        status: "in_progress",
        sections: keys.map((k) => ({
          key: k,
          title: t(`postMortem.section.${k}`),
          body: k === "root_cause" ? body : "",
        })),
        aiDrafted: true,
        ownerMemberId: current.member.id,
      });
    }
  });
  revalidatePath(`/app/incidents/${number}`);
}
