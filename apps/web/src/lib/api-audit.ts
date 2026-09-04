import { auditEvents, type Tx } from "@openincident/db";
import type { ApiContext } from "@/lib/api";

/**
 * The audit line of a change made through the public API. There is no member
 * behind it: the actor is the key, by the name the administrator gave it.
 */
export async function recordApiAudit(
  tx: Tx,
  ctx: ApiContext,
  category: "config" | "data",
  action: string,
  target: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(auditEvents).values({
    tenantId: ctx.tenant.id,
    actorMemberId: null,
    actorName: `API key "${ctx.key.name}"`,
    category,
    action,
    target: { ...target, apiKeyId: ctx.key.id },
  });
}
