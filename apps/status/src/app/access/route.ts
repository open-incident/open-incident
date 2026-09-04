/**
 * GET /access?t=<token> — the door of an internal page. The product signed
 * the token for a signed-in member; verified here with the shared secret, it
 * becomes a cookie for the day and the visitor lands on the page. Anything
 * else is a 404, like an unknown host.
 */
import {
  STATUS_ACCESS_COOKIE,
  STATUS_ACCESS_TTL_MS,
  verifyStatusAccess,
} from "@openincident/statuspages";
import { currentSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cur = await currentSnapshot({ skipAccess: true });
  if (!cur) return new Response("Not found", { status: 404 });
  const token = new URL(request.url).searchParams.get("t");
  if (!verifyStatusAccess(token, cur.row.pageId)) return new Response("Not found", { status: 404 });
  const secure = cur.origin.startsWith("https://");
  return new Response(null, {
    status: 302,
    headers: {
      location: "/",
      "set-cookie": `${STATUS_ACCESS_COOKIE}=${encodeURIComponent(token!)}; Path=/; Max-Age=${Math.floor(STATUS_ACCESS_TTL_MS / 1000)}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
      "cache-control": "no-store",
    },
  });
}
