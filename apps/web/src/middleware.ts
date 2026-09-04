/**
 * Multi-tenant resolution by subdomain.
 *
 * {slug}.$BASE_DOMAIN            → the workspace "slug"
 * $BASE_DOMAIN (bare domain)     → DEFAULT_TENANT_SLUG (single-workspace self-hosting), otherwise 404
 * reserved subdomain             → 404 (www, console, api, status, docs…)
 * any other host                 → a custom domain, resolved in the database downstream
 *
 * In dev: skylark.localhost:3100 works with no DNS configuration.
 */
import { NextResponse, type NextRequest } from "next/server";
import { RESERVED_SUBDOMAINS } from "@openincident/config";
import { WORKSPACE_NOT_FOUND } from "@/lib/workspace-not-found";

const BASE_DOMAIN = (process.env.BASE_DOMAIN ?? "localhost:3100").toLowerCase();

type Resolution = { slug: string } | { customHost: string } | null;

/**
 * Shape only — never existence.
 *
 * There is no database on the edge, so a slug that merely *looks* right gets
 * through here; whether the workspace exists is settled downstream by
 * `requireTenant()` (see lib/tenant.ts). Both checks are needed: this one keeps
 * reserved subdomains out, that one keeps invented ones out.
 */
function resolve(host: string): Resolution {
  const h = host.toLowerCase();
  if (h === BASE_DOMAIN) {
    const slug = process.env.DEFAULT_TENANT_SLUG;
    return slug ? { slug } : null;
  }
  if (!h.endsWith(`.${BASE_DOMAIN}`)) {
    return h ? { customHost: h } : null;
  }
  const slug = h.slice(0, -(BASE_DOMAIN.length + 1));
  if (!slug || slug.includes(".")) return null;
  if ((RESERVED_SUBDOMAINS as readonly string[]).includes(slug)) return null;
  return { slug };
}

function notFound(): NextResponse {
  // The only product message that CANNOT be translated, and it is not an
  // oversight: the language comes from the workspace, and the workspace is
  // precisely what could not be resolved. In cloud (SIGNUP_URL defined), the
  // page invites creating one. Same words as app/not-found.tsx.
  const signupUrl = process.env.SIGNUP_URL;
  if (signupUrl) {
    return new NextResponse(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Workspace not found</title></head>` +
        `<body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#F3F5F6;color:#0D161C">` +
        `<div style="text-align:center;padding:24px;max-width:420px"><h1 style="font-size:22px;margin:0 0 10px">${WORKSPACE_NOT_FOUND.title}</h1>` +
        `<p style="font-size:14px;color:#515F66;margin:0 0 18px">${WORKSPACE_NOT_FOUND.body}</p>` +
        `<a href="${signupUrl}" style="display:inline-block;background:#0B4A6F;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:9px">${WORKSPACE_NOT_FOUND.cta}</a></div></body></html>`,
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  return new NextResponse(
    "Workspace not found. Check the address, or set DEFAULT_TENANT_SLUG when self-hosting.",
    { status: 404 },
  );
}

export function middleware(request: NextRequest) {
  // The host the browser asked for. Behind a proxy it travels in
  // x-forwarded-host — and Next.js itself sets that header when it renders the
  // target of a server-action redirect through an internal request whose Host
  // is the listen address. Reading Host alone there resolved the bare domain,
  // i.e. DEFAULT_TENANT_SLUG: another workspace's page after every redirect.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const res = resolve(host);
  if (!res) return notFound();

  const headers = new Headers(request.headers);
  if ("slug" in res) headers.set("x-tenant-slug", res.slug);
  else headers.set("x-tenant-host", res.customHost);
  // Server layouts have no access to the path: the suspension screen needs it.
  headers.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|favicon.svg|fonts/).*)"],
};
