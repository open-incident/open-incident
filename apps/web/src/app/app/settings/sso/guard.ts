import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  authAccounts,
  authDb,
  authUsers,
  members,
  ssoConnections,
  withTenant,
} from "@openincident/db";

type Connection = typeof ssoConnections.$inferSelect;

function covers(c: Pick<Connection, "allowedDomains">, email: string): boolean {
  if (c.allowedDomains.length === 0) return true;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return c.allowedDomains.some((d) => d.toLowerCase() === domain);
}

/**
 * Removing a connection must not leave the workspace without an owner who can
 * sign in. For every active member, the ways in that remain once it is gone:
 * a password — unless another "SSO only" connection covers the email's
 * domain — or an account at another of the workspace's connections.
 *
 * Returns the members for whom the connection is the only way in, and
 * whether an owner is among them with no other owner left able to sign in —
 * the case the removal is refused for.
 */
export async function removalLockout(
  tenantId: string,
  connectionId: string,
): Promise<{ refused: boolean; onlyWayIn: number }> {
  const { connections, active } = await withTenant(tenantId, async (tx) => ({
    connections: await tx
      .select()
      .from(ssoConnections)
      .where(eq(ssoConnections.tenantId, tenantId)),
    active: await tx
      .select({ email: members.email, role: members.role })
      .from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.status, "active"))),
  }));
  const target = connections.find((c) => c.id === connectionId);
  if (!target || active.length === 0) return { refused: false, onlyWayIn: 0 };
  const others = connections.filter((c) => c.id !== connectionId);
  const otherProviders = new Set(others.map((c) => c.providerId));

  const emails = active.map((m) => m.email.toLowerCase());
  const accounts = await authDb
    .select({ email: authUsers.email, providerId: authAccounts.providerId })
    .from(authAccounts)
    .innerJoin(authUsers, eq(authUsers.id, authAccounts.userId))
    .where(inArray(sql`lower(${authUsers.email})`, emails));
  const byEmail = new Map<string, Set<string>>();
  for (const a of accounts) {
    const k = a.email.toLowerCase();
    byEmail.set(k, (byEmail.get(k) ?? new Set()).add(a.providerId));
  }

  const after = (email: string) => {
    const ways = byEmail.get(email) ?? new Set<string>();
    const password = ways.has("credential") && !others.some((c) => c.enforce && covers(c, email));
    return password || [...ways].some((p) => otherProviders.has(p));
  };

  const relying = active.filter((m) => {
    const email = m.email.toLowerCase();
    return (byEmail.get(email)?.has(target.providerId) ?? false) && !after(email);
  });
  const ownerRelies = relying.some((m) => m.role === "owner");
  const ownerLeft = active.some((m) => m.role === "owner" && after(m.email.toLowerCase()));
  return { refused: ownerRelies && !ownerLeft, onlyWayIn: relying.length };
}
