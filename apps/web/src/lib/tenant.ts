import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  getTenantByCustomDomain,
  getTenantBySlug,
  withTenant,
  workspaces,
  type Tenant,
} from "@openincident/db";

export type Workspace = typeof workspaces.$inferSelect;

/**
 * Current tenant (resolved from the host) — the directory row, readable before
 * any tenant context exists. Memoised per request: the root layout, the shell
 * and the pages all need it, and it must cost one query.
 */
export const getTenantFromHeaders = cache(async (): Promise<Tenant | null> => {
  const h = await headers();
  const slug = h.get("x-tenant-slug");
  if (process.env.DEBUG_TENANT)
    console.log(
      "[tenant]",
      JSON.stringify({
        slug,
        host: h.get("host"),
        xfh: h.get("x-forwarded-host"),
        action: Boolean(h.get("next-action")),
        rsc: h.get("rsc"),
        path: h.get("x-pathname"),
      }),
    );
  if (slug) return getTenantBySlug(slug);
  const host = h.get("x-tenant-host");
  if (host) return getTenantByCustomDomain(host);
  return null;
});

/**
 * Current tenant, or a 404 — the guard every public entry point owes the host.
 *
 * The middleware only validates the *shape* of the subdomain: it runs on the
 * edge, with no database, so it cannot tell `skylark` from
 * `secure-paypal-login`. A sign-in form rendered under any hostname, with a
 * wildcard certificate, is a phishing kit anyone can address — and what Safe
 * Browsing flags for the whole domain. It has to be `notFound()` rather than a
 * rendered message: only a real 404 keeps these hostnames out of the index.
 */
export async function requireTenant(): Promise<Tenant> {
  const tenant = await getTenantFromHeaders().catch(() => null);
  if (!tenant) notFound();
  return tenant;
}

/** The workspace's own row (name, language, branding) — under RLS, memoised. */
export const getWorkspace = cache(async (): Promise<Workspace | null> => {
  const tenant = await getTenantFromHeaders();
  if (!tenant) return null;
  return withTenant(tenant.id, async (tx) => {
    const [row] = await tx.select().from(workspaces).where(eq(workspaces.tenantId, tenant.id));
    return row ?? null;
  });
});

/** Tenant + workspace, or a 404 — for the pages that render to anonymous visitors. */
export async function requireWorkspace(): Promise<{ tenant: Tenant; workspace: Workspace }> {
  const tenant = await requireTenant();
  const workspace = await getWorkspace();
  if (!workspace) notFound();
  return { tenant, workspace };
}

/**
 * Real origin of a request, rebuilt from the `Host` header.
 *
 * A route handler's `request.url` does not always carry the workspace's
 * subdomain; a redirect built on it loses the workspace and falls into a 404.
 */
export function requestOrigin(request: {
  headers: { get: (name: string) => string | null };
  nextUrl: { host: string; protocol: string };
}): string {
  // Behind a proxy, and inside the internal request Next.js issues to render a
  // server-action redirect, the browser's host travels in x-forwarded-host.
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto =
    request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** Same thing from a server component or action. */
export async function currentOrigin(): Promise<string> {
  const h = await headers();
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? process.env.BASE_DOMAIN ?? "localhost:3100";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
