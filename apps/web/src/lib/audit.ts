import { auditEvents, type Tx } from "@openincident/db";
import type { CurrentMember } from "@/lib/session";

type Category = "config" | "security" | "members" | "data";

/**
 * One line in the audit log, written in the same transaction as the change it
 * records. The actor is always named — a snapshot, so the line outlives the
 * member.
 */
export async function recordAudit(
  tx: Tx,
  current: CurrentMember,
  category: Category,
  action: string,
  target: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(auditEvents).values({
    tenantId: current.tenant.id,
    actorMemberId: current.member.id,
    actorName: current.member.name,
    category,
    action,
    target,
  });
}
