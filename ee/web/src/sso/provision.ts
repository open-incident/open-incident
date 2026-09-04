/**
 * What happens on the product side of an SSO sign-in: the member row.
 * Better Auth owns the identity (auth.user); the workspace owns membership
 * (app.members, matched on email). A connection says whether an unknown
 * email becomes a member on the spot, with which role, from which domains.
 */
import { and, eq } from "drizzle-orm";
import { auditEvents, members, ssoConnections, withTenant } from "@openincident/db";

export type SsoConnection = typeof ssoConnections.$inferSelect;

export function domainAllowed(connection: Pick<SsoConnection, "allowedDomains">, email: string) {
  if (connection.allowedDomains.length === 0) return true;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return connection.allowedDomains.some((d) => d.toLowerCase() === domain);
}

/** The enforcing connection that covers this email's domain, if any. */
export async function enforcedConnectionFor(
  tenantId: string,
  email: string,
): Promise<SsoConnection | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(ssoConnections)
      .where(and(eq(ssoConnections.tenantId, tenantId), eq(ssoConnections.enforce, true)));
    return rows.find((c) => domainAllowed(c, email)) ?? null;
  });
}

export type ProvisionInput = {
  providerId: string;
  tenantId: string | null;
  user: { id: string; email: string; name: string };
};

/**
 * Runs after every SSO sign-in. Creates the member on first sight when the
 * connection allows it; a disabled member stays disabled — the door refuses
 * them afterwards, as it does for a password sign-in. Every sign-in is an
 * audit line: who came in, through which provider.
 */
export async function provisionSsoMember(input: ProvisionInput): Promise<void> {
  if (!input.tenantId) return;
  const email = input.user.email.toLowerCase();
  await withTenant(input.tenantId, async (tx) => {
    const [connection] = await tx
      .select()
      .from(ssoConnections)
      .where(
        and(
          eq(ssoConnections.tenantId, input.tenantId!),
          eq(ssoConnections.providerId, input.providerId),
        ),
      );
    if (!connection) return;
    const [existing] = await tx
      .select({ id: members.id, status: members.status, name: members.name })
      .from(members)
      .where(and(eq(members.tenantId, input.tenantId!), eq(members.email, email)));
    let created = false;
    if (!existing && connection.jitProvisioning && domainAllowed(connection, email)) {
      await tx.insert(members).values({
        tenantId: input.tenantId!,
        email,
        name: input.user.name || email,
        role: connection.defaultRole,
        status: "active",
        source: "sso",
      });
      created = true;
    } else if (existing && existing.status === "invited") {
      // An invited member who arrives through SSO has accepted, in effect.
      await tx.update(members).set({ status: "active" }).where(eq(members.id, existing.id));
    }
    await tx
      .update(ssoConnections)
      .set({ lastSignInAt: new Date() })
      .where(eq(ssoConnections.id, connection.id));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId!,
      actorMemberId: existing?.id ?? null,
      actorName: existing?.name ?? input.user.name ?? email,
      category: "security",
      action: "session.sso_signed_in",
      target: { provider: connection.label, email, providerId: connection.providerId, created },
    });
  });
}
