/**
 * GET /app/monitors/<id>/shot/<checkId> — the screenshot a failed journey left.
 *
 * Served by the product rather than by a bucket URL, for the same reason as the
 * workspace logo: the bucket stays private, and the key is never in the
 * address. The key is read from the check row inside the workspace's own
 * context, so one workspace cannot ask for another's picture by guessing a
 * path.
 */
import { and, eq } from "drizzle-orm";
import { monitorChecks, withTenant } from "@openincident/db";
import { isSyntheticResult } from "@openincident/oncall";
import { getObject, storageConfigured } from "@openincident/storage";
import { requireMember } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; checkId: string }> },
) {
  if (!storageConfigured()) return new Response("Not found", { status: 404 });
  const { tenant } = await requireMember();
  const { id, checkId } = await params;

  const [check] = await withTenant(tenant.id, (tx) =>
    tx
      .select({ result: monitorChecks.result })
      .from(monitorChecks)
      .where(
        and(
          eq(monitorChecks.tenantId, tenant.id),
          eq(monitorChecks.monitorId, id),
          eq(monitorChecks.id, checkId),
        ),
      ),
  );
  const result = check?.result;
  const key = isSyntheticResult(result) ? result.screenshotKey : undefined;
  if (!key) return new Response("Not found", { status: 404 });

  const obj = await getObject(key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(obj.body), {
    headers: {
      "content-type": obj.contentType ?? "image/png",
      // A screenshot may show a signed-in page: it is nobody's to cache.
      "cache-control": "private, no-store",
      "content-security-policy": "sandbox; default-src 'none'",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
