"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { incidents, postMortems, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireResponder } from "@/lib/session";
import { ensurePostMortem, recordRevision, templateFor } from "@/lib/post-mortem";
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

/**
 * Post-incident — the whole draft, or one section regenerated. The document is
 * created from the workspace's template first, so custom sections are drafted
 * too; the history records the assistant's pass like any other change.
 */
export async function draftPostMortemAction(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const sectionKey = String(formData.get("section") ?? "") || undefined;
  const t = await getT();
  const template = templateFor(current.workspace, t);
  const titles = Object.fromEntries(template.map((s) => [s.key, s.title]));
  const hints = Object.fromEntries(template.map((s) => [s.key, s.hint]));
  const tenantId = current.tenant.id;
  await withTenant(tenantId, async (tx) => {
    const [inc] = await tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number)));
    if (inc)
      await ensurePostMortem(tx, tenantId, inc.id, template, {
        memberId: current.member.id,
        name: current.member.name,
      });
  });
  const out = await draftPostMortem(tenantId, actorOf(current), number, {
    sectionKey,
    titles,
    hints,
  });
  if (out.ok)
    await withTenant(tenantId, async (tx) => {
      const [inc] = await tx
        .select({ id: incidents.id })
        .from(incidents)
        .where(and(eq(incidents.tenantId, tenantId), eq(incidents.number, number)));
      const [pm] = inc
        ? await tx.select().from(postMortems).where(eq(postMortems.incidentId, inc.id))
        : [];
      if (pm)
        await recordRevision(
          tx,
          tenantId,
          pm,
          sectionKey ? "ai_section" : "ai_draft",
          { memberId: current.member.id, name: current.member.name },
          sectionKey ?? null,
        );
    });
  revalidatePath(`/app/incidents/${number}`);
}

/** Post-incident — a section edited by hand; kept for the smoke suite, the editor calls pm-actions. */
export async function savePostMortemSection(formData: FormData) {
  const { savePostMortemBody } = await import("./pm-actions");
  await savePostMortemBody(formData);
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
