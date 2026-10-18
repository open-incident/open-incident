"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { customRoles, members, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { entitlementsFor } from "@/lib/entitlements";
import { recordAudit } from "@/lib/audit";
import { sendMemberInvite } from "@/lib/member-invite";
import { requireManager } from "@/lib/session";
import type { DialogResult } from "@/components/settings/dialog";

/** What a row's button gets back: done, or the reason it was not. */
export type RowResult = { ok: true } | { ok: false; error: string };

const emailSchema = z.string().trim().toLowerCase().email();
const PATH = "/app/settings/members";

type Role = "owner" | "admin" | "responder" | "viewer";

/**
 * A role as the selects post it: a built-in one, or `custom:<id>` for a
 * custom role (enterprise) — the member then keeps the role's base as `role`.
 */
async function resolveRole(
  tenant: Parameters<typeof entitlementsFor>[0] & { id: string },
  raw: string,
): Promise<{ role: Role; customRoleId: string | null; name: string } | null> {
  if (raw.startsWith("custom:")) {
    const id = z.string().uuid().safeParse(raw.slice(7));
    if (!id.success || !entitlementsFor(tenant).customRoles) return null;
    const [custom] = await withTenant(tenant.id, (tx) =>
      tx
        .select({ base: customRoles.base, name: customRoles.name })
        .from(customRoles)
        .where(and(eq(customRoles.tenantId, tenant.id), eq(customRoles.id, id.data))),
    );
    return custom ? { role: custom.base, customRoleId: id.data, name: custom.name } : null;
  }
  const role = z.enum(["owner", "admin", "responder", "viewer"]).safeParse(raw);
  return role.success ? { role: role.data, customRoleId: null, name: role.data } : null;
}

/** "+ Invite": a row per new address with the shared role, an email per row. */
export async function inviteMembers(
  _prev: DialogResult,
  formData: FormData,
): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const resolved = await resolveRole(current.tenant, String(formData.get("role") ?? "responder"));
  // An invitation never makes an owner: that is appointed afterwards, by an owner.
  const role =
    resolved && resolved.role !== "owner"
      ? resolved
      : { role: "responder" as const, customRoleId: null, name: "responder" };
  const emails = [
    ...new Set(
      String(formData.get("emails") ?? "")
        .split(/[\s,;]+/)
        .map((e) => emailSchema.safeParse(e))
        .filter((r) => r.success)
        .map((r) => r.data!),
    ),
  ];
  if (emails.length === 0) return { ok: false, error: t("settingsV2.members.error.noAddress") };

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
          role: role.role,
          customRoleId: role.customRoleId,
          status: "invited",
        })
        .onConflictDoNothing()
        .returning({ id: members.id, email: members.email });
      if (row) {
        rows.push(row);
        await recordAudit(tx, current, "members", "member.invited", { email, role: role.name });
      }
    }
    return rows;
  });
  if (inserted.length === 0) return { ok: false, error: t("settingsV2.members.error.allMembers") };
  for (const row of inserted)
    await sendMemberInvite(current.tenant, current.workspace.name, row, current.member.name);
  revalidatePath(PATH);
  return { ok: true, message: t("settingsV2.members.flash.sent", { count: inserted.length }) };
}

/** The role select of a row, saved the moment it changes. */
export async function updateRole(formData: FormData): Promise<RowResult> {
  const current = await requireManager();
  const t = await getT();
  const denied = { ok: false as const, error: t("settingsV2.members.error.denied") };
  const memberId = z.string().uuid().parse(formData.get("memberId"));
  if (memberId === current.member.id) return denied; // one does not change one's own role
  const next = await resolveRole(current.tenant, String(formData.get("role") ?? ""));
  if (!next) return { ok: false, error: t("settingsV2.error.invalid") };
  if (next.role === "owner" && next.customRoleId === null && current.member.role !== "owner")
    return denied; // only an owner appoints an owner
  return withTenant(current.tenant.id, async (tx) => {
    const [target] = await tx
      .select()
      .from(members)
      .where(and(eq(members.tenantId, current.tenant.id), eq(members.id, memberId)));
    if (!target || (target.role === "owner" && current.member.role !== "owner")) return denied;
    if (target.role === next.role && target.customRoleId === next.customRoleId)
      return { ok: true } as const;
    await tx
      .update(members)
      .set({ role: next.role, customRoleId: next.customRoleId })
      .where(eq(members.id, target.id));
    await recordAudit(tx, current, "members", "member.role_changed", {
      member: target.name,
      from: target.customRoleId ? `custom:${target.customRoleId}` : target.role,
      to: next.name,
    });
    revalidatePath(PATH);
    return { ok: true } as const;
  });
}

/** Disabled ↔ active. A disabled member is refused at the door from then on. */
export async function disableMember(formData: FormData): Promise<RowResult> {
  const current = await requireManager();
  const t = await getT();
  const denied = { ok: false as const, error: t("settingsV2.members.error.denied") };
  const memberId = z.string().uuid().parse(formData.get("memberId"));
  if (memberId === current.member.id) return denied;
  const result = await withTenant(current.tenant.id, async (tx) => {
    const [target] = await tx
      .select()
      .from(members)
      .where(and(eq(members.tenantId, current.tenant.id), eq(members.id, memberId)));
    if (!target || target.status === "invited") return denied;
    if (target.role === "owner" && current.member.role !== "owner") return denied;
    const next = target.status === "disabled" ? "active" : "disabled";
    await tx.update(members).set({ status: next }).where(eq(members.id, target.id));
    await recordAudit(
      tx,
      current,
      "members",
      next === "disabled" ? "member.disabled" : "member.reactivated",
      { member: target.name, email: target.email },
    );
    return { ok: true } as const;
  });
  revalidatePath(PATH);
  return result;
}

export async function resendInvite(formData: FormData): Promise<RowResult> {
  const current = await requireManager();
  const t = await getT();
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
  if (!target) return { ok: false, error: t("settingsV2.members.error.denied") };
  await sendMemberInvite(
    current.tenant,
    current.workspace.name,
    { id: target.id, email: target.email },
    current.member.name,
  );
  revalidatePath(PATH);
  return { ok: true };
}

/** Revoking an invitation deletes the row: nothing was ever accepted. */
export async function revokeInvite(formData: FormData): Promise<RowResult> {
  const current = await requireManager();
  const t = await getT();
  const memberId = z.string().uuid().parse(formData.get("memberId"));
  const done = await withTenant(current.tenant.id, async (tx) => {
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
    if (!target) return false;
    await tx.delete(members).where(eq(members.id, target.id));
    await recordAudit(tx, current, "members", "member.invite_revoked", { email: target.email });
    return true;
  });
  if (!done) return { ok: false, error: t("settingsV2.members.error.denied") };
  revalidatePath(PATH);
  return { ok: true };
}
