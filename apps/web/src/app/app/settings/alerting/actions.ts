"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { escalationPaths, members, schedules, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { requireManager } from "@/lib/session";
import { ensureQuickPath, pageWithPath } from "@/lib/alerting-setup";

const PAGE = "/app/settings/alerting";

/** "Page me": a published path that pages the person clicking, named on the route that catches everything. */
export async function pageMe() {
  const current = await requireManager();
  const t = await getT();
  await withTenant(current.tenant.id, async (tx) => {
    const path = await ensureQuickPath(
      tx,
      current.tenant.id,
      { memberId: current.member.id },
      { kind: "member", memberId: current.member.id },
      t("setup.quickPath.member", { name: current.member.name }),
    );
    await pageWithPath(
      tx,
      current.tenant.id,
      path.id,
      t("setup.catchAll"),
      t("setup.catchAllDesc"),
    );
    await recordAudit(tx, current, "config", "alerting.page_me", { path: path.name });
  });
  revalidatePath("/app/settings");
  redirect(`${PAGE}?saved=pager`);
}

/** "Page a schedule": the same, for whoever is on call on the chosen schedule. */
export async function pageSchedule(formData: FormData) {
  const current = await requireManager();
  const scheduleId = z.string().uuid().parse(formData.get("scheduleId"));
  const t = await getT();
  await withTenant(current.tenant.id, async (tx) => {
    const [sched] = await tx
      .select({ id: schedules.id, name: schedules.name })
      .from(schedules)
      .where(and(eq(schedules.tenantId, current.tenant.id), eq(schedules.id, scheduleId)));
    if (!sched) return;
    const path = await ensureQuickPath(
      tx,
      current.tenant.id,
      { memberId: current.member.id },
      { kind: "schedule", scheduleId: sched.id },
      t("setup.quickPath.schedule", { name: sched.name }),
    );
    await pageWithPath(
      tx,
      current.tenant.id,
      path.id,
      t("setup.catchAll"),
      t("setup.catchAllDesc"),
    );
    await recordAudit(tx, current, "config", "alerting.page_schedule", { path: path.name });
  });
  revalidatePath("/app/settings");
  redirect(`${PAGE}?saved=pager`);
}

/** "Page someone": a colleague, by the same one-level path. */
export async function pageMember(formData: FormData) {
  const current = await requireManager();
  const memberId = z.string().uuid().parse(formData.get("memberId"));
  const t = await getT();
  await withTenant(current.tenant.id, async (tx) => {
    const [m] = await tx
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(and(eq(members.tenantId, current.tenant.id), eq(members.id, memberId)));
    if (!m) return;
    const path = await ensureQuickPath(
      tx,
      current.tenant.id,
      { memberId: current.member.id },
      { kind: "member", memberId: m.id },
      t("setup.quickPath.member", { name: m.name }),
    );
    await pageWithPath(
      tx,
      current.tenant.id,
      path.id,
      t("setup.catchAll"),
      t("setup.catchAllDesc"),
    );
    await recordAudit(tx, current, "config", "alerting.page_member", { path: path.name });
  });
  revalidatePath("/app/settings");
  redirect(`${PAGE}?saved=pager`);
}

/** An escalation path the workspace already built, named on the catch-all route. */
export async function useExistingPath(formData: FormData) {
  const current = await requireManager();
  const pathId = z.string().uuid().parse(formData.get("pathId"));
  const t = await getT();
  await withTenant(current.tenant.id, async (tx) => {
    const [p] = await tx
      .select({ id: escalationPaths.id, name: escalationPaths.name })
      .from(escalationPaths)
      .where(and(eq(escalationPaths.tenantId, current.tenant.id), eq(escalationPaths.id, pathId)));
    if (!p) return;
    await pageWithPath(tx, current.tenant.id, p.id, t("setup.catchAll"), t("setup.catchAllDesc"));
    await recordAudit(tx, current, "config", "alerting.page_path", { path: p.name });
  });
  revalidatePath("/app/settings");
  redirect(`${PAGE}?saved=pager`);
}
