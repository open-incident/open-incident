import { getStatusSnapshotForHost } from "@openincident/db";

export const dynamic = "force-dynamic";

/**
 * The gate a reverse proxy asks before issuing a certificate for a hostname it
 * has never seen — Caddy's `on_demand_tls { ask … }`, and the equivalent in
 * other proxies.
 *
 * Status pages answer on their own domain once a customer points a CNAME at
 * us, and that domain is known only at the first TLS handshake. Issuing a
 * certificate for whatever hostname resolves to this server would let anyone
 * mint certificates in our name and burn the certificate authority's rate
 * limits; refusing everything would break the custom domains the product
 * promises. So the proxy asks, and this answers for the domains we actually
 * serve.
 *
 * A domain is served when a published page carries it: the snapshot only ever
 * records a custom domain once its DNS has been verified (see
 * packages/statuspages/snapshot.ts). Nothing else gets a certificate.
 *
 * `STATUS_TLS_ASK_KEY` is optional and matches the key in the proxy's ask URL:
 * on a shared host it keeps the endpoint from being used to enumerate which
 * domains we serve. Unset, the endpoint answers anyone — the information is
 * public anyway (the pages are).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const expected = process.env.STATUS_TLS_ASK_KEY;
  if (expected && url.searchParams.get("key") !== expected) {
    return new Response("forbidden", { status: 403 });
  }

  // Caddy appends ?domain=<sni>; the hostname never carries a port or a path.
  const domain = (url.searchParams.get("domain") ?? "").trim().toLowerCase();
  if (!domain || domain.length > 253 || !/^[a-z0-9.-]+$/.test(domain)) {
    return new Response("invalid domain", { status: 400 });
  }

  // The base domain without its development port: the proxy speaks in hostnames.
  const base = (process.env.STATUS_BASE_DOMAIN ?? "status.localhost:3107").split(":")[0]!;
  const row = await getStatusSnapshotForHost(
    domain,
    base,
    process.env.STATUS_DEFAULT_PAGE || undefined,
  ).catch(() => null);

  // 200 is the only answer that lets a certificate be issued.
  return row ? new Response("ok") : new Response("unknown domain", { status: 404 });
}
