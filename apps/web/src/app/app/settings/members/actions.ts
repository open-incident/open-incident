"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { customRoles, members, withTenant } from "@openincident/db";
import { entitlementsFor } from "@/lib/entitlements";
import { recordAudit } from "@/lib/audit";
import { sendMemberInvite } from "@/lib/member-invite";
import { requireManager } from "@/lib/session";

const emailSchema = z.string().trim().toLowerCase().email();

/** Multi-email invitation with a shared role: a row per address, an email per row that did not exist. */
export async function inviteMembers(formData: FormData) {
  const current = await requireManager();
  const role = z
    .enum(["admin", "responder", "viewer"])
    .catch("responder")
    .parse(formData.get("role"));
  const emails = [
    ...new Set(
      String(formData.get("emails") ?? "")
        .split(/[\s,;]+/)
        .map((e) => emailSchema.safeParse(e))
        .filter((r) => r.success)
        .map((r) => r.data!),
    ),
  ];
  if (emails.length === 0) redirect("/app/settings/members?error=emails");

  const inserted = await withTenant(current.tenant.id, async (tx) => {
    const rows: Array<{ id: string; email: string }> = [];
    for (const email of emails) {
      const name = (email.split("@")[0] ?? email)
        .split(/[._-]+/)
        .filter(Boolean)
        .map((p) => p[0]!.toUpperCase() + p.slice(1))
        .join(" ");
      const [row] = await tx
        .insert(members)
        .values({
          tenantId: current.tenant.id,
          email,
          name: name || email,
          role,
          status: "invited",
        })
        .onConflictDoNothing()
        .returning({ id: members.id, email: members.email });
      if (row) {
        rows.push(row);
        await recordAudit(tx, current, "members", "member.invited", { email, role });
      }
    }
    return rows;
  });
  for (const row of inserted)
    await sendMemberInvite(current.tenant, current.workspace.name, row, current.member.name);
  revalidatePath("/app/settings/members");
  redirect("/app/settings/members?saved=1");
}

export async function updateRole(formData: FormData) {
  const current = await requireManager();
  const memberId = z.string().uuid().parse(formData.get("memberId"));
  const raw = String(formData.get("role") ?? "");
  // A custom role (enterprise) is `custom:<id>`; the member keeps its base as `role`.
  const customRoleId = raw.startsWith("custom:") ? z.string().uuid().parse(raw.slice(7)) : null;
  if (memberId === current.member.id) return; // one does not change one's own role
  await withTenant(current.tenant.id, async (tx) => {
    let role: "owner" | "admin" | "responder" | "viewer";
    let roleName = raw;
    if (customRoleId) {
      if (!entitlementsFor(current.tenant).customRoles) return;
      const [custom] = await tx
        .select({ base: customRoles.base, name: customRoles.name })
        .from(customRoles)
        .where(and(eq(customRoles.tenantId, current.tenant.id), eq(customRoles.id, customRoleId)));
      if (!custom) return;
      role = custom.base;
      roleName = custom.name;
    } else {
      role = z.enum(["owner", "admin", "responder", "viewer"]).parse(raw);
    }
    if (role === "owner" && current.member.role !== "owner") return; // only an owner appoints an owner
    const [target] = await tx
      .select()
      .from(members)
      .where(and(eq(members.tenantId, current.tenant.id), eq(members.id, memberId)));
    if (
      !target ||
      (target.role === "owner" && current.member.role !== "owner") ||
      (target.role === role && target.customRoleId === customRoleId)
    )
      return;
    await tx.update(members).set({ role, customRoleId }).where(eq(members.id, target.id));
    await recordAudit(tx, current, "members", "member.role_changed", {
      member: target.name,
      from: target.customRoleId ? `custom:${target.customRoleId}` : target.role,
      to: roleName,
    });
  });
  revalidatePath("/app/settings/members");
}

/** Disabled ↔ active. A disabled member is refused at the door from then on. */
export async function disableMember(formData: FormData) {
  const current = await requireManager();
  const memberId = z.string().uuid().parse(formData.get("memberId"));
  if (memberId === current.member.id) return;
  await withTenant(current.tenant.id, async (tx) => {
    const [target] = await tx
      .select()
      .from(members)
      .where(and(eq(members.tenantId, current.tenant.id), eq(members.id, memberId)));
    if (!target || (target.role === "owner" && current.member.role !== "owner")) return;
    const next = target.status === "disabled" ? "active" : "disabled";
    await tx.update(members).set({ status: next }).where(eq(members.id, target.id));
    await recordAudit(
      tx,
      current,
      "members",
      next === "disabled" ? "member.disabled" : "member.reactivated",
      { member: target.name, email: target.email },
    );
  });
  revalidatePath("/app/settings/members");
}

export async function resendInvite(formData: FormData) {
  const current = await requireManager();
  const memberId = z.string().uuid().parse(formData.get("memberId"));
  const target = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(members)
      .where(
        and(
          eq(members.tenantId, current.tenant.id),
          eq(members.id, memberId),
          eq(members.status, "invited"),
        ),
      );
    return row ?? null;
  });
  if (target)
    await sendMemberInvite(
      current.tenant,
      current.workspace.name,
      { id: target.id, email: target.email },
      current.member.name,
    );
  revalidatePath("/app/settings/members");
}

/** Revoking an invitation deletes the row: nothing was ever accepted. */
export async function revokeInvite(formData: FormData) {
  const current = await requireManager();
  const memberId = z.string().uuid().parse(formData.get("memberId"));
  await withTenant(current.tenant.id, async (tx) => {
    const [target] = await tx
      .select()
      .from(members)
      .where(
        and(
          eq(members.tenantId, current.tenant.id),
          eq(members.id, memberId),
          eq(members.status, "invited"),
        ),
      );
    if (!target) return;
    await tx.delete(members).where(eq(members.id, target.id));
    await recordAudit(tx, current, "members", "member.invite_revoked", { email: target.email });
  });
  revalidatePath("/app/settings/members");
}
