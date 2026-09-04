/**
 * Enterprise auth plugins for Better Auth: single sign-on (OIDC and SAML)
 * with just-in-time membership, and the "SSO only" rule that refuses a
 * password sign-in for the domains a connection enforces.
 */
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { sso } from "@better-auth/sso";
import { getTenantByCustomDomain, getTenantBySlug } from "@openincident/db";
import { enforcedConnectionFor, provisionSsoMember } from "../sso/provision";

/** Resolves the tenant the way the app's middleware tags requests. */
async function tenantIdFromHeaders(headers: Headers | undefined): Promise<string | null> {
  if (!headers) return null;
  const slug = headers.get("x-tenant-slug");
  if (slug) return (await getTenantBySlug(slug))?.id ?? null;
  const host = headers.get("x-tenant-host");
  if (host) return (await getTenantByCustomDomain(host))?.id ?? null;
  return null;
}

const ssoOnly: BetterAuthPlugin = {
  id: "openincident-sso-only",
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === "/sign-in/email",
        handler: createAuthMiddleware(async (ctx) => {
          const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "")
            .trim()
            .toLowerCase();
          if (!email) return;
          const tenantId = await tenantIdFromHeaders(ctx.headers);
          if (!tenantId) return;
          const enforced = await enforcedConnectionFor(tenantId, email);
          if (enforced)
            throw new APIError("FORBIDDEN", {
              code: "SSO_REQUIRED",
              message: `Sign in with ${enforced.label}: this workspace requires single sign-on for ${email.split("@")[1]}.`,
            });
        }),
      },
    ],
  },
};

export function eeAuthPlugins(): BetterAuthPlugin[] {
  return [
    sso({
      provisionUser: async ({ user, provider }) => {
        await provisionSsoMember({
          providerId: provider.providerId,
          tenantId: provider.organizationId ?? null,
          user: { id: user.id, email: user.email, name: user.name },
        });
      },
      provisionUserOnEveryLogin: true,
      trustEmailVerified: true,
    }),
    ssoOnly,
  ];
}
