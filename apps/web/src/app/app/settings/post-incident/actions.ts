"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { postIncidentTaskDefs, withTenant, workspaces } from "@openincident/db";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";

const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  phase: z.enum(["documenting", "reviewing"]),
  defaultAssigneeRole: z.enum(["lead", "communication", "none"]).default("lead"),
  dueAfterDays: z.string().optional(),
});

/** Adds a task definition to a phase; incidents entering the flow from now on get it. */
export async function createTask(formData: FormData) {
  const current = await requireManager();
  const parsed = taskSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect("/app/settings/post-incident?error=invalid");
  const input = parsed.data;
  await withTenant(current.tenant.id, async (tx) => {
    const [maxRow] = await tx
      .select({
        max: sql<number>`coalesce(max(${postIncidentTaskDefs.position}), -1)`.mapWith(Number),
      })
      .from(postIncidentTaskDefs)
      .where(
        and(
          eq(postIncidentTaskDefs.tenantId, current.tenant.id),
          eq(postIncidentTaskDefs.phase, input.phase),
        ),
      );
    await tx.insert(postIncidentTaskDefs).values({
      tenantId: current.tenant.id,
      phase: input.phase,
      title: input.title,
      defaultAssigneeRole: input.defaultAssigneeRole === "none" ? null : input.defaultAssigneeRole,
      dueAfterDays: input.dueAfterDays ? Number(input.dueAfterDays) : null,
      position: (maxRow?.max ?? -1) + 1,
    });
    await recordAudit(tx, current, "config", "post_incident_task.created", {
      title: input.title,
      phase: input.phase,
    });
  });
  revalidatePath("/app/settings/post-incident");
  redirect("/app/settings/post-incident?saved=1");
}

export async function deleteTask(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(postIncidentTaskDefs)
      .where(
        and(eq(postIncidentTaskDefs.tenantId, current.tenant.id), eq(postIncidentTaskDefs.id, id)),
      );
    if (!row) return;
    await tx.delete(postIncidentTaskDefs).where(eq(postIncidentTaskDefs.id, row.id));
    await recordAudit(tx, current, "config", "post_incident_task.deleted", { title: row.title });
  });
  revalidatePath("/app/settings/post-incident");
}

/** The word the workspace uses for its post-mortem. Empty: the product's own. */
export async function savePostMortemTerm(formData: FormData) {
  const current = await requireManager();
  const term = z
    .string()
    .trim()
    .max(40)
    .parse(formData.get("term") ?? "");
  await withTenant(current.tenant.id, async (tx) => {
    await tx
      .update(workspaces)
      .set({ postMortemTerm: term || null, updatedAt: new Date() })
      .where(eq(workspaces.tenantId, current.tenant.id));
    await recordAudit(tx, current, "config", "workspace.post_mortem_term", { term: term || null });
  });
  revalidatePath("/", "layout");
  redirect("/app/settings/post-incident?saved=1");
}

const templateSchema = z
  .array(
    z.object({
      key: z.string().max(40).optional().default(""),
      title: z.string().trim().min(1).max(120),
      hint: z.string().trim().max(400).default(""),
    }),
  )
  .min(1)
  .max(12);

/** A key for a template section: the one it had, or one from its title, unique in the list. */
function templateKey(title: string, given: string, taken: string[]): string {
  if (/^[a-z][a-z0-9_]{0,39}$/.test(given) && !taken.includes(given)) return given;
  const base =
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "section";
  let key = base;
  let i = 2;
  while (taken.includes(key)) key = `${base}_${i++}`;
  return key;
}

/** The sections a new post-mortem starts with. "reset" goes back to the product's six. */
export async function savePostMortemTemplate(formData: FormData) {
  const current = await requireManager();
  const reset = formData.get("reset") === "1";
  let template: Array<{ key: string; title: string; hint: string }> | null = null;
  if (!reset) {
    let raw: unknown;
    try {
      raw = JSON.parse(String(formData.get("template") ?? "[]"));
    } catch {
      redirect("/app/settings/post-incident?error=1");
    }
    const parsed = templateSchema.safeParse(raw);
    if (!parsed.success) redirect("/app/settings/post-incident?error=1");
    const taken: string[] = [];
    template = parsed.data.map((row) => {
      const key = templateKey(row.title, row.key, taken);
      taken.push(key);
      return { key, title: row.title, hint: row.hint };
    });
  }
  await withTenant(current.tenant.id, async (tx) => {
    await tx
      .update(workspaces)
      .set({ postMortemTemplate: template, updatedAt: new Date() })
      .where(eq(workspaces.tenantId, current.tenant.id));
    await recordAudit(tx, current, "config", "workspace.post_mortem_template", {
      sections: template?.map((s) => s.key) ?? null,
    });
  });
  revalidatePath("/", "layout");
  redirect("/app/settings/post-incident?saved=1");
}
