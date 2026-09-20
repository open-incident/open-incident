"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isManager, requireMember } from "@/lib/session";
import { createDashboard, deleteDashboard, setPublic } from "@/lib/dashboards";
import { importGrafana } from "@/lib/grafana-import";

const LIST = "/app/dashboards";

export async function newDashboard(form: FormData): Promise<void> {
  const { tenant, member } = await requireMember();
  if (!isManager(member)) redirect(LIST);
  const title = String(form.get("title") ?? "").trim();
  if (!title) redirect(`${LIST}?error=title`);
  const slug = await createDashboard(tenant.id, member.id, { title });
  revalidatePath(LIST);
  redirect(`${LIST}/${slug}`);
}

/**
 * Importing a Grafana dashboard.
 *
 * The report is stored with the dashboard rather than shown once and lost: a
 * migration nobody can audit a week later is a migration nobody trusts.
 */
export async function importDashboard(form: FormData): Promise<void> {
  const { tenant, member } = await requireMember();
  if (!isManager(member)) redirect(LIST);
  const file = form.get("file");
  const pasted = String(form.get("json") ?? "").trim();
  const text = file instanceof File && file.size > 0 ? await file.text() : pasted;
  if (!text) redirect(`${LIST}?error=empty`);

  let result;
  try {
    result = importGrafana(JSON.parse(text));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unreadable file";
    redirect(`${LIST}?error=${encodeURIComponent(reason)}`);
  }
  const slug = await createDashboard(tenant.id, member.id, {
    title: result.title,
    layout: { panels: result.panels },
    variables: result.variables,
    importedFrom: "grafana",
    importReport: result.report,
  });
  revalidatePath(LIST);
  redirect(`${LIST}/${slug}`);
}

export async function removeDashboard(form: FormData): Promise<void> {
  const { tenant, member } = await requireMember();
  if (!isManager(member)) redirect(LIST);
  await deleteDashboard(tenant.id, String(form.get("slug") ?? ""));
  revalidatePath(LIST);
  redirect(LIST);
}

export async function toggleShare(form: FormData): Promise<void> {
  const { tenant, member } = await requireMember();
  if (!isManager(member)) redirect(LIST);
  const slug = String(form.get("slug") ?? "");
  await setPublic(tenant.id, slug, form.get("on") === "1");
  revalidatePath(`${LIST}/${slug}`);
  redirect(`${LIST}/${slug}`);
}
