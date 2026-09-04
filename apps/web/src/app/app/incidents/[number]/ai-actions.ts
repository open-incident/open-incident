"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { incidents, postMortems, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireResponder } from "@/lib/session";
import {
  draftPostMortem,
  draftUpdate,
  generateIncidentSummary,
  suggestFollowUps,
  type AiOutcome,
  type AiRefusal,
} from "@/lib/ai-capabilities";

const numberSchema = z.coerce.number().int().positive();

async function refusalMessage(reason: AiRefusal): Promise<string> {
  const t = await getT();
  return t(`ai.refusal.${reason}`);
}

async function unwrap<T>(out: AiOutcome<T>): Promise<{ value: T } | { error: string }> {
  return out.ok ? { value: out.value } : { error: await refusalMessage(out.reason) };
}

const actorOf = (c: Awaited<ReturnType<typeof requireResponder>>) => ({
  kind: "member" as const,
  memberId: c.member.id,
  name: c.member.name,
});

/** Side panel — "Generate" / "Regenerate" the AI summary. */
export async function regenerateSummary(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  await generateIncidentSummary(current.tenant.id, actorOf(current), number);
  revalidatePath(`/app/incidents/${number}`);
}

/** Update dialog — the draft appears in the message field; the person edits and posts. */
export async function draftUpdateMessage(
  number: number,
): Promise<{ value: string } | { error: string }> {
  const current = await requireResponder();
  return unwrap(await draftUpdate(current.tenant.id, actorOf(current), numberSchema.parse(number)));
}

/** Follow-ups tab — suggestions; each becomes a follow-up only when clicked. */
export async function suggestFollowUpsFor(
  number: number,
): Promise<{ value: Array<{ title: string; priority: "P1" | "P2" | "P3" }> } | { error: string }> {
  const current = await requireResponder();
  return unwrap(
    await suggestFollowUps(current.tenant.id, actorOf(current), numberSchema.parse(number)),
  );
}

/** Post-incident — the whole draft, or one section regenerated. */
export async function draftPostMortemAction(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const sectionKey = String(formData.get("section") ?? "") || undefined;
  const t = await getT();
  const keys = ["summary", "impact", "timeline", "root_cause", "went_well", "improve"] as const;
  const titles = Object.fromEntries(keys.map((k) => [k, t(`postMortem.section.${k}`)]));
  await draftPostMortem(current.tenant.id, actorOf(current), number, { sectionKey, titles });
  revalidatePath(`/app/incidents/${number}`);
}

/** Post-incident — a section edited by hand; the AI banner stays, the words are now the person's. */
export async function savePostMortemSection(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const key = z.string().min(1).max(40).parse(formData.get("section"));
  const body = z
    .string()
    .max(20_000)
    .parse(formData.get("body") ?? "");
  const tenantId = current.tenant.id;
  await withTenant(tenantId, async (tx) => {
    const [inc] = await tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number)));
    if (!inc) return;
    const [pm] = await tx.select().from(postMortems).where(eq(postMortems.incidentId, inc.id));
    if (!pm) return;
    const sections = pm.sections.map((s) => (s.key === key ? { ...s, body: body.trim() } : s));
    await tx.update(postMortems).set({ sections }).where(eq(postMortems.id, pm.id));
  });
  revalidatePath(`/app/incidents/${number}`);
}

/** Post-incident — the status step: in progress → in review → completed. */
export async function setPostMortemStatus(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const status = z.enum(["in_progress", "in_review", "completed"]).parse(formData.get("status"));
  const tenantId = current.tenant.id;
  await withTenant(tenantId, async (tx) => {
    const [inc] = await tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number)));
    if (!inc) return;
    await tx
      .update(postMortems)
      .set({ status, publishedAt: status === "completed" ? new Date() : null })
      .where(eq(postMortems.incidentId, inc.id));
  });
  revalidatePath(`/app/incidents/${number}`);
}
