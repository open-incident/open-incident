/**
 * SSO connections: the product's row (app.sso_connections) and the Better Auth
 * provider row (auth.sso_provider) written together. The plugin's own
 * `/sso/register` endpoint is bypassed on purpose — it expects the organization
 * plugin to say who may register — so the checks that matter are made here:
 * discovery for OIDC, a certificate source for SAML, and a lock-out guard.
 */
import { and, eq } from "drizzle-orm";
import { discoverOIDCConfig } from "@better-auth/sso";
import type { MemberRole } from "@openincident/config";
import { authDb, authSsoProviders, members, ssoConnections, withTenant } from "@openincident/db";

export type SsoConnectionRow = typeof ssoConnections.$inferSelect;
type Role = MemberRole;

export type SsoInput = {
  kind: "oidc" | "saml";
  label: string;
  allowedDomains: string[];
  defaultRole: Role;
  jitProvisioning: boolean;
  enforce: boolean;
  oidc?: { issuer: string; clientId: string; clientSecret: string };
  saml?: { entryPoint: string; entityId: string; cert: string; metadata: string };
};

export type SsoResult =
  | { ok: true; providerId: string }
  | { ok: false; code: "invalid" | "lockout" | "discovery" | "duplicate"; detail?: string };

/** `${origin}/api/auth` — the plugin's base; the URLs given to the provider derive from it. */
export function ssoUrls(origin: string, providerId: string) {
  const base = `${origin.replace(/\/$/, "")}/api/auth`;
  return {
    redirectUri: `${base}/sso/callback/${providerId}`,
    acsUrl: `${base}/sso/saml2/sp/acs/${providerId}`,
    metadataUrl: `${base}/sso/saml2/sp/metadata?providerId=${encodeURIComponent(providerId)}`,
    entityId: `${base}/sso/saml2/sp/metadata?providerId=${encodeURIComponent(providerId)}`,
  };
}

export async function listSsoConnections(tenantId: string): Promise<SsoConnectionRow[]> {
  return withTenant(tenantId, (tx) =>
    tx.select().from(ssoConnections).where(eq(ssoConnections.tenantId, tenantId)),
  );
}

/** What the sign-in page shows: one button per connection. */
export async function ssoSignInOptions(
  tenantId: string,
): Promise<Array<{ providerId: string; label: string }>> {
  const rows = await listSsoConnections(tenantId);
  return rows.map((r) => ({ providerId: r.providerId, label: r.label }));
}

function normaliseDomains(list: string[]): string[] {
  return [
    ...new Set(
      list
        .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
        .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)),
    ),
  ];
}

/**
 * Enforcement must never lock every owner out: with "SSO only" on, at least
 * one active owner needs an email outside the enforced domains — or a
 * previous SSO sign-in proving the door opens (then the owners can use it).
 */
async function wouldLockOut(
  tenantId: string,
  domains: string[],
  otherEnforced: SsoConnectionRow[],
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const owners = await tx
      .select({ email: members.email })
      .from(members)
      .where(
        and(
          eq(members.tenantId, tenantId),
          eq(members.role, "owner"),
          eq(members.status, "active"),
        ),
      );
    const covered = (email: string) => {
      const domain = email.split("@")[1]?.toLowerCase() ?? "";
      if (domains.length === 0) return true;
      if (domains.includes(domain)) return true;
      return otherEnforced.some(
        (c) => c.allowedDomains.length === 0 || c.allowedDomains.includes(domain),
      );
    };
    return owners.every((o) => covered(o.email));
  });
}

export async function createSsoConnection(
  tenantId: string,
  origin: string,
  input: SsoInput,
  actorMemberId: string | null,
): Promise<SsoResult> {
  const label = input.label.trim().slice(0, 60);
  if (label.length < 2) return { ok: false, code: "invalid", detail: "label" };
  const domains = normaliseDomains(input.allowedDomains);
  const providerId = `oi-${tenantId.slice(0, 8)}-${input.kind}-${Date.now().toString(36)}`;
  const urls = ssoUrls(origin, providerId);

  let issuer: string;
  let oidcConfig: string | null = null;
  let samlConfig: string | null = null;
  if (input.kind === "oidc") {
    const o = input.oidc;
    if (!o || !/^https?:\/\//.test(o.issuer) || !o.clientId || !o.clientSecret)
      return { ok: false, code: "invalid", detail: "oidc" };
    issuer = o.issuer.replace(/\/$/, "");
    try {
      const hydrated = await discoverOIDCConfig({
        issuer,
        existingConfig: {
          discoveryEndpoint: `${issuer}/.well-known/openid-configuration`,
        },
        isTrustedOrigin: () => true,
      });
      oidcConfig = JSON.stringify({
        issuer: hydrated.issuer,
        clientId: o.clientId,
        clientSecret: o.clientSecret,
        authorizationEndpoint: hydrated.authorizationEndpoint,
        tokenEndpoint: hydrated.tokenEndpoint,
        tokenEndpointAuthentication: hydrated.tokenEndpointAuthentication,
        jwksEndpoint: hydrated.jwksEndpoint,
        userInfoEndpoint: hydrated.userInfoEndpoint,
        discoveryEndpoint: hydrated.discoveryEndpoint,
        pkce: true,
        scopes: ["openid", "email", "profile"],
        overrideUserInfo: false,
      });
    } catch (e) {
      return { ok: false, code: "discovery", detail: e instanceof Error ? e.message : String(e) };
    }
  } else {
    const s = input.saml;
    const metadata = s?.metadata.trim() ?? "";
    const entityId = s?.entityId.trim() ?? "";
    const cert = s?.cert.trim() ?? "";
    const entryPoint = s?.entryPoint.trim() ?? "";
    if (!metadata && (!entityId || !cert || !/^https?:\/\//.test(entryPoint)))
      return { ok: false, code: "invalid", detail: "saml" };
    issuer = urls.entityId;
    samlConfig = JSON.stringify({
      issuer,
      entryPoint: entryPoint || undefined,
      cert: cert || undefined,
      audience: urls.entityId,
      callbackUrl: urls.acsUrl,
      idpMetadata: metadata
        ? { metadata, ...(cert ? { cert } : {}) }
        : { entityID: entityId, cert },
      wantAssertionsSigned: false,
    });
  }

  const existing = await listSsoConnections(tenantId);
  if (existing.some((c) => c.label.toLowerCase() === label.toLowerCase()))
    return { ok: false, code: "duplicate" };
  if (input.enforce) {
    const others = existing.filter((c) => c.enforce);
    if (await wouldLockOut(tenantId, domains, others)) return { ok: false, code: "lockout" };
  }

  await authDb.insert(authSsoProviders).values({
    id: crypto.randomUUID(),
    issuer,
    oidcConfig,
    samlConfig,
    userId: null,
    providerId,
    organizationId: tenantId,
    domain: domains[0] ?? `${providerId}.invalid`,
  });
  await withTenant(tenantId, (tx) =>
    tx.insert(ssoConnections).values({
      tenantId,
      providerId,
      kind: input.kind,
      label,
      defaultRole: input.defaultRole,
      allowedDomains: domains,
      enforce: input.enforce,
      jitProvisioning: input.jitProvisioning,
      createdByMemberId: actorMemberId,
    }),
  );
  return { ok: true, providerId };
}

export async function removeSsoConnection(tenantId: string, id: string): Promise<string | null> {
  const providerId = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ providerId: ssoConnections.providerId })
      .from(ssoConnections)
      .where(and(eq(ssoConnections.tenantId, tenantId), eq(ssoConnections.id, id)));
    if (!row) return null;
    await tx.delete(ssoConnections).where(eq(ssoConnections.id, id));
    return row.providerId;
  });
  if (providerId)
    await authDb.delete(authSsoProviders).where(eq(authSsoProviders.providerId, providerId));
  return providerId;
}
