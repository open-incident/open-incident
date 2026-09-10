"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  incidents,
  postMortemComments,
  postMortemRevisions,
  postMortems,
  withTenant,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireResponder } from "@/lib/session";
import {
  ensurePostMortem,
  keyFor,
  recordRevision,
  templateFor,
  type Section,
} from "@/lib/post-mortem";
import { refinePostMortemSection, reviewPostMortem } from "@/lib/ai-capabilities";

const numberSchema = z.coerce.number().int().positive();
const keySchema = z.string().min(1).max(60);

type Current = Awaited<ReturnType<typeof requireResponder>>;
const actorOf = (c: Current) => ({ memberId: c.member.id, name: c.member.name });

/** The incident's post-mortem row, created from the template when it does not exist yet. */
async function withDocument<T>(
  current: Current,
  number: number,
  fn: (
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    pm: typeof postMortems.$inferSelect,
  ) => Promise<T>,
): Promise<T | null> {
  const t = await getT();
  const template = templateFor(current.workspace, t);
  return withTenant(current.tenant.id, async (tx) => {
    const [inc] = await tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.tenantId, current.tenant.id), eq(incidents.number, number)));
    if (!inc) return null;
    const pm = await ensurePostMortem(tx, current.tenant.id, inc.id, template, actorOf(current));
    return fn(tx, pm);
  });
}

async function saveSections(
  current: Current,
  number: number,
  kind: "edit" | "structure" | "restore" | "title",
  sectionKey: string | null,
  change: (pm: typeof postMortems.$inferSelect) => { sections?: Section[]; title?: string | null },
) {
  await withDocument(current, number, async (tx, pm) => {
    const next = change(pm);
    const sections = next.sections ?? pm.sections;
    const title = next.title === undefined ? pm.title : next.title;
    await tx
      .update(postMortems)
      .set({ sections, title, updatedAt: new Date() })
      .where(eq(postMortems.id, pm.id));
    await recordRevision(
      tx,
      current.tenant.id,
      { id: pm.id, title, sections },
      kind,
      actorOf(current),
      sectionKey,
    );
  });
  revalidatePath(`/app/incidents/${number}`);
}

/** "Start the post-mortem" — the document with its empty sections, no model call. */
export async function startPostMortem(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  await withDocument(current, number, async (tx, pm) => {
    const [existing] = await tx
      .select({ id: postMortemRevisions.id })
      .from(postMortemRevisions)
      .where(eq(postMortemRevisions.postMortemId, pm.id))
      .limit(1);
    if (!existing) await recordRevision(tx, current.tenant.id, pm, "structure", actorOf(current));
  });
  revalidatePath(`/app/incidents/${number}`);
}

export async function savePostMortemTitle(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const title = z
    .string()
    .trim()
    .max(200)
    .parse(formData.get("title") ?? "");
  await saveSections(current, number, "title", null, () => ({ title: title || null }));
}

export async function addPostMortemSection(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const title = z.string().trim().min(1).max(120).parse(formData.get("title"));
  await saveSections(current, number, "structure", null, (pm) => ({
    sections: [
      ...pm.sections,
      {
        key: keyFor(
          title,
          pm.sections.map((s) => s.key),
        ),
        title,
        body: "",
      },
    ],
  }));
}

export async function renamePostMortemSection(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const key = keySchema.parse(formData.get("section"));
  const title = z.string().trim().min(1).max(120).parse(formData.get("title"));
  await saveSections(current, number, "structure", key, (pm) => ({
    sections: pm.sections.map((s) => (s.key === key ? { ...s, title } : s)),
  }));
}

export async function movePostMortemSection(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const key = keySchema.parse(formData.get("section"));
  const dir = z.enum(["up", "down"]).parse(formData.get("dir"));
  await saveSections(current, number, "structure", key, (pm) => {
    const i = pm.sections.findIndex((s) => s.key === key);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= pm.sections.length) return {};
    const sections = [...pm.sections];
    [sections[i], sections[j]] = [sections[j]!, sections[i]!];
    return { sections };
  });
}

/** A section a person added can be removed; the template's own stay (empty them instead). */
export async function deletePostMortemSection(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const key = keySchema.parse(formData.get("section"));
  await saveSections(current, number, "structure", key, (pm) => ({
    sections: pm.sections.filter((s) => s.key !== key),
  }));
}

/** A person's words replace the section; the history keeps what was there. */
export async function savePostMortemBody(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const key = keySchema.parse(formData.get("section"));
  const body = z
    .string()
    .max(40_000)
    .parse(formData.get("body") ?? "");
  await saveSections(current, number, "edit", key, (pm) => ({
    sections: pm.sections.map((s) => (s.key === key ? { ...s, body: body.trim() } : s)),
  }));
}

/** Tighten, enrich or rewrite one section — one model call, one section. */
export async function refineSectionAction(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const key = keySchema.parse(formData.get("section"));
  const mode = z.enum(["tighten", "enrich", "rewrite"]).parse(formData.get("mode"));
  const out = await refinePostMortemSection(
    current.tenant.id,
    { kind: "member", memberId: current.member.id, name: current.member.name },
    number,
    key,
    mode,
  );
  if (out.ok)
    await withDocument(current, number, (tx, pm) =>
      recordRevision(tx, current.tenant.id, pm, "ai_refine", actorOf(current), key),
    );
  revalidatePath(`/app/incidents/${number}`);
}

/** The whole document checked against the incident's facts — one call, notes kept per section. */
export async function reviewPostMortemAction(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  await reviewPostMortem(
    current.tenant.id,
    { kind: "member", memberId: current.member.id, name: current.member.name },
    number,
  );
  revalidatePath(`/app/incidents/${number}`);
}

export async function addPostMortemComment(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const sectionKey = String(formData.get("section") ?? "") || null;
  const body = z.string().trim().min(1).max(4000).parse(formData.get("body"));
  await withDocument(current, number, (tx, pm) =>
    tx.insert(postMortemComments).values({
      tenantId: current.tenant.id,
      postMortemId: pm.id,
      sectionKey,
      body,
      memberId: current.member.id,
      memberName: current.member.name,
    }),
  );
  revalidatePath(`/app/incidents/${number}`);
}

export async function resolvePostMortemComment(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const id = z.string().uuid().parse(formData.get("id"));
  const reopen = formData.get("reopen") === "1";
  await withTenant(current.tenant.id, (tx) =>
    tx
      .update(postMortemComments)
      .set(
        reopen
          ? { resolvedAt: null, resolvedByName: null }
          : { resolvedAt: new Date(), resolvedByName: current.member.name },
      )
      .where(
        and(eq(postMortemComments.tenantId, current.tenant.id), eq(postMortemComments.id, id)),
      ),
  );
  revalidatePath(`/app/incidents/${number}`);
}

/** Back to an earlier snapshot — itself recorded, so nothing in the history is lost. */
export async function restorePostMortemRevision(formData: FormData) {
  const current = await requireResponder();
  const number = numberSchema.parse(formData.get("number"));
  const id = z.string().uuid().parse(formData.get("id"));
  const [rev] = await withTenant(current.tenant.id, (tx) =>
    tx
      .select()
      .from(postMortemRevisions)
      .where(
        and(eq(postMortemRevisions.tenantId, current.tenant.id), eq(postMortemRevisions.id, id)),
      ),
  );
  if (!rev) return;
  await saveSections(current, number, "restore", null, () => ({
    sections: rev.sections,
    title: rev.title,
  }));
}
