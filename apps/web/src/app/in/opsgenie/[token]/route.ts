/**
 * POST /in/opsgenie/{token} — shadow mode's door (Opsgenie migration, step 5).
 *
 * Opsgenie's Webhook integration posts every alert action here. A new alert
 * ("Create") is compared, after the response, against what Open Incident's
 * imported (inactive) rules and schedules would have done; nothing is paged,
 * no escalation is started. Other actions are acknowledged and ignored.
 *
 * Reachable on the workspace's host and on the bare domain: the token itself
 * resolves its workspace (directory lookup on its hash), so the URL can be
 * pasted as shown. The alert's content is data, never an instruction.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getTenantIdForApiKeyHash, migrationRuns, withTenant } from "@openincident/db";
import {
  alertFromWebhook,
  clientFor,
  recordShadow,
  type OgWebhookPayload,
} from "@openincident/migrate-opsgenie";
import { apiError, apiJson } from "@/lib/api";
import { getTenantFromHeaders } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const MAX_BYTES = 256 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[\w-]{16,64}$/.test(token)) return apiError(404, "unknown_hook", "No such webhook.");
  const hash = createHash("sha256").update(token).digest("hex");
  const tenant = await getTenantFromHeaders().catch(() => null);
  const tenantId = tenant?.id ?? (await getTenantIdForApiKeyHash(`og:${hash}`));
  if (!tenantId) return apiError(404, "unknown_hook", "No such webhook.");
  const run = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(migrationRuns)
      .where(
        and(
          eq(migrationRuns.tenantId, tenantId),
          eq(migrationRuns.shadowTokenHash, hash),
          isNull(migrationRuns.completedAt),
        ),
      );
    return row ?? null;
  });
  if (!run?.shadowTokenHash) return apiError(404, "unknown_hook", "No such webhook.");
  const a = Buffer.from(run.shadowTokenHash);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return apiError(404, "unknown_hook", "No such webhook.");

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return apiError(413, "too_large", "The payload is too large.");
  let payload: OgWebhookPayload;
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) return apiError(413, "too_large", "The payload is too large.");
    payload = JSON.parse(text) as OgWebhookPayload;
  } catch {
    return apiError(400, "invalid_payload", "The body is not JSON.");
  }
  if ((payload.action ?? "Create") !== "Create")
    return apiJson({ data: { action: "ignored" } }, 202);
  const alert = alertFromWebhook(payload);
  if (!alert) return apiError(422, "no_alert", "The payload carries no alert.");
  // Opsgenie wants a quick answer; the comparison asks it who was on call.
  after(async () => {
    await recordShadow(
      (fn) => withTenant(tenantId, fn),
      tenantId,
      run.id,
      alert,
      clientFor(run),
    ).catch((err) => console.error("[opsgenie shadow]", err instanceof Error ? err.message : err));
  });
  return apiJson({ data: { action: "compared", alert_id: alert.id } }, 202);
}
