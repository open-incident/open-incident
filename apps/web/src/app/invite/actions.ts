"use server";

/**
 * Accepting a member invitation: the HMAC token proves control of the address —
 * the Better Auth identity is created with the email already marked verified,
 * then the member moves invited → active. This is the ONLY invited → active
 * transition in the product.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { verifyInviteToken } from "@openincident/crypto";
import { authUsers, authDb, members, withTenant } from "@openincident/db";
import { getTenantFromHeaders } from "@/lib/tenant";

export async function acceptInvite(formData: FormData) {
  const tenant = await getTenantFromHeaders();
  if (!tenant) redirect("/login");

  const token = String(formData.get("token") ?? "");
  const memberId = verifyInviteToken(tenant.id, token);
  if (!memberId) redirect(`/invite/${encodeURIComponent(token)}?error=invalid`);

  const invited = await withTenant(tenant.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(members)
      .where(and(eq(members.tenantId, tenant.id), eq(members.id, memberId)));
    return row ?? null;
  });
  if (!invited) redirect(`/invite/${encodeURIComponent(token)}?error=invalid`);
  if (invited.status === "active") redirect("/login?accepted=1");
  if (invited.status === "disabled") redirect("/login?error=not-a-member");

  const name =
    String(formData.get("name") ?? "")
      .trim()
      .slice(0, 80) || invited.name;
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) redirect(`/invite/${encodeURIComponent(token)}?error=password`);

  try {
    await auth.api.signUpEmail({ body: { email: invited.email, password, name } });
  } catch (err) {
    // Identity already exists (a member of another workspace): the invitation
    // stays valid, activation is enough — they sign in with their usual
    // password. Any other error is a real one.
    if (!(err instanceof APIError && err.status === "UNPROCESSABLE_ENTITY")) {
      console.error("[invite] could not create identity:", err);
      redirect(`/invite/${encodeURIComponent(token)}?error=failed`);
    }
  }

  // Clicking the invitation link counts as verification of the address.
  await authDb
    .update(authUsers)
    .set({ emailVerified: true })
    .where(eq(authUsers.email, invited.email));
  await withTenant(tenant.id, (tx) =>
    tx
      .update(members)
      .set({ status: "active", name })
      .where(and(eq(members.tenantId, tenant.id), eq(members.id, invited.id))),
  );

  redirect("/login?accepted=1");
}

/** A session already open on the right address (back from OAuth): direct activation. */
export async function activateFromSession(token: string): Promise<boolean> {
  const tenant = await getTenantFromHeaders();
  if (!tenant) return false;
  const memberId = verifyInviteToken(tenant.id, token);
  if (!memberId) return false;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return false;
  return withTenant(tenant.id, async (tx) => {
    const [invited] = await tx
      .select()
      .from(members)
      .where(and(eq(members.tenantId, tenant.id), eq(members.id, memberId)));
    if (!invited || invited.status !== "invited") return false;
    if (invited.email !== session.user.email.toLowerCase()) return false;
    await tx.update(members).set({ status: "active" }).where(eq(members.id, invited.id));
    return true;
  });
}
