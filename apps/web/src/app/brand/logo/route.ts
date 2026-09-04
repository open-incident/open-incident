/**
 * GET /brand/logo[?variant=dark] — the workspace's logo, streamed from object
 * storage. Served by the product rather than from a public bucket URL so the
 * bucket can stay private; SVG is sandboxed by policy so an uploaded file can
 * never run script in the product's origin.
 */
import { getObject, storageConfigured } from "@openincident/storage";
import { getTenantFromHeaders, getWorkspace } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!storageConfigured()) return new Response("Not found", { status: 404 });
  const tenant = await getTenantFromHeaders().catch(() => null);
  if (!tenant) return new Response("Not found", { status: 404 });
  const workspace = await getWorkspace();
  const variant = new URL(request.url).searchParams.get("variant") === "dark" ? "dark" : "light";
  const key =
    variant === "dark"
      ? (workspace?.branding.logoDarkKey ?? workspace?.branding.logoKey)
      : workspace?.branding.logoKey;
  if (!key) return new Response("Not found", { status: 404 });
  const obj = await getObject(key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(obj.body), {
    headers: {
      "content-type": obj.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=300",
      "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
