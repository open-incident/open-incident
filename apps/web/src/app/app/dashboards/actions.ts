"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isManager, requireMember } from "@/lib/session";
import { createDashboard, deleteDashboard, setPublic } from "@/lib/dashboards";
import { importGrafana } from "@/lib/grafana-import";

/*
 * The list lives in Telemetry now; the detail keeps its own route. A refusal
 * has to come back to the screen the form was on, which is the tab.
 */
const LIST = "/app/dashboards";
const TAB = "/app/telemetry?tab=dashboards";

export async function newDashboard(form: FormData): Promise<void> {
  const { tenant, member } = await requireMember();
  if (!isManager(member)) redirect(TAB);
  const title = String(form.get("title") ?? "").trim();
  if (!title) redirect(`${TAB}&error=title`);
  const slug = await createDashboard(tenant.id, member.id, { title });
  revalidatePath(TAB);
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
  if (!isManager(member)) redirect(TAB);
  const file = form.get("file");
  const pasted = String(form.get("json") ?? "").trim();
  const text = file instanceof File && file.size > 0 ? await file.text() : pasted;
  if (!text) redirect(`${TAB}&error=empty`);

  let result;
  try {
    result = importGrafana(JSON.parse(text));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unreadable file";
    redirect(`${TAB}&error=${encodeURIComponent(reason)}`);
  }
  const slug = await createDashboard(tenant.id, member.id, {
    title: result.title,
    layout: { panels: result.panels },
    variables: result.variables,
    importedFrom: "grafana",
    importReport: result.report,
  });
  revalidatePath(TAB);
  redirect(`${LIST}/${slug}`);
}

export async function removeDashboard(form: FormData): Promise<void> {
  const { tenant, member } = await requireMember();
  if (!isManager(member)) redirect(TAB);
  await deleteDashboard(tenant.id, String(form.get("slug") ?? ""));
  revalidatePath(TAB);
  redirect(TAB);
}

export async function toggleShare(form: FormData): Promise<void> {
  const { tenant, member } = await requireMember();
  if (!isManager(member)) redirect(TAB);
  const slug = String(form.get("slug") ?? "");
  await setPublic(tenant.id, slug, form.get("on") === "1");
  revalidatePath(`${LIST}/${slug}`);
  redirect(`${LIST}/${slug}`);
}
