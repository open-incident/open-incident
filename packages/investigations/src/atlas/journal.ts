/**
 * The journal: one atlas_actions row per step, mirrored on the incident's
 * timeline (kind atlas_action), with its cost — the one record every screen
 * reads (the Atlas tab, the timeline, the review queue, the audit log, the
 * post-mortem's "What Atlas did").
 *
 * Fixed engine sentences carry a dictionary key in `payload.text`
 * ({ key: "atlas.j.checks", params }) so each reader sees them in their own
 * language; `title` keeps an English rendering for the API and the chat.
 * What the model wrote (the fix, in the incident's language) is stored as is.
 */
import { and, eq, sql } from "drizzle-orm";
import {
  atlasActions,
  auditEvents,
  incidentEvents,
  investigations,
  withTenant,
  type AtlasActionKind,
  type AtlasApprovalState,
  type AutonomyLevel,
  type Tx,
} from "@openincident/db";

export type AtlasActionRow = typeof atlasActions.$inferSelect;

export type JournalText = { key: string; params?: Record<string, string | number> };

export type JournalStep = {
  tenantId: string;
  incidentId: string;
  investigationId: string | null;
  serviceId: string | null;
  kind: AtlasActionKind;
  title: string;
  text?: JournalText;
  detail?: string | null;
  actionKey?: string | null;
  level: number | null;
  autonomous?: boolean;
  reversible?: boolean;
  approvalState?: AtlasApprovalState;
  approvalRequestedAt?: Date | null;
  executedAt?: Date | null;
  verifiedAt?: Date | null;
  decidedByMemberId?: string | null;
  costEur?: number;
  tokens?: number;
  sources?: string[];
  payload?: Record<string, unknown>;
  at?: Date;
  /** Timeline actor for a human step. */
  actorName?: string | null;
};

/** The timeline line of a journal row written earlier (a fix whose outcome is now known). */
export async function mirrorToTimelineTx(tx: Tx, row: AtlasActionRow): Promise<void> {
  if (!row.incidentId) return;
  const text = row.payload?.text as JournalText | undefined;
  await tx.insert(incidentEvents).values({
    tenantId: row.tenantId,
    incidentId: row.incidentId,
    kind: "atlas_action",
    actorKind: "ai",
    actorName: "Atlas",
    payload: {
      actionId: row.id,
      title: row.title,
      detail: row.detail,
      kind: row.kind,
      autonomous: row.autonomous,
      reversible: row.reversible,
      level: row.level,
      phase: row.kind === "system" ? (row.executedAt ? "executed" : "proposed") : undefined,
      ...(text ? { text } : {}),
    },
    occurredAt: row.executedAt ?? row.at,
  });
}

/** Adds a step's cost to its run. */
export async function addCostTx(
  tx: Tx,
  investigationId: string | null,
  costEur: number,
  tokens: number,
): Promise<void> {
  if (!investigationId || (costEur <= 0 && tokens <= 0)) return;
  await tx
    .update(investigations)
    .set({
      costEur: sql`${investigations.costEur} + ${costEur}`,
      tokensTotal: sql`${investigations.tokensTotal} + ${tokens}`,
    })
    .where(eq(investigations.id, investigationId));
}

/** Writes one step and its timeline line, in the caller's transaction. */
export async function recordStepTx(tx: Tx, s: JournalStep): Promise<AtlasActionRow> {
  const at = s.at ?? new Date();
  const payload = { ...(s.payload ?? {}), ...(s.text ? { text: s.text } : {}) };
  const [row] = await tx
    .insert(atlasActions)
    .values({
      tenantId: s.tenantId,
      investigationId: s.investigationId,
      incidentId: s.incidentId,
      serviceId: s.serviceId,
      at,
      kind: s.kind,
      actionKey: s.actionKey ?? null,
      title: s.title.slice(0, 300),
      detail: s.detail ? s.detail.slice(0, 1000) : null,
      payload,
      decidedBy: s.kind === "human" ? "member" : "atlas",
      decidedByMemberId: s.kind === "human" ? (s.decidedByMemberId ?? null) : null,
      level: (s.level ?? null) as AutonomyLevel | null,
      autonomous: Boolean(s.autonomous),
      approvalState: s.approvalState ?? "none",
      approvalRequestedAt: s.approvalRequestedAt ?? null,
      executedAt: s.executedAt ?? null,
      verifiedAt: s.verifiedAt ?? null,
      reversible: Boolean(s.reversible),
      costEur: Math.round((s.costEur ?? 0) * 10_000) / 10_000,
      tokens: s.tokens ?? 0,
      sources: s.sources ?? [],
    })
    .returning();
  await tx.insert(incidentEvents).values({
    tenantId: s.tenantId,
    incidentId: s.incidentId,
    kind: "atlas_action",
    actorKind: s.kind === "human" ? "member" : "ai",
    actorMemberId: s.kind === "human" ? (s.decidedByMemberId ?? null) : null,
    actorName: s.kind === "human" ? (s.actorName ?? null) : "Atlas",
    payload: {
      actionId: row!.id,
      title: row!.title,
      detail: row!.detail,
      kind: s.kind,
      autonomous: Boolean(s.autonomous),
      reversible: Boolean(s.reversible),
      level: s.level,
      phase: s.kind === "system" ? (s.executedAt ? "executed" : "proposed") : undefined,
      ...(s.text ? { text: s.text } : {}),
    },
    occurredAt: at,
  });
  if (s.investigationId && ((s.costEur ?? 0) > 0 || (s.tokens ?? 0) > 0))
    await tx
      .update(investigations)
      .set({
        costEur: sql`${investigations.costEur} + ${s.costEur ?? 0}`,
        tokensTotal: sql`${investigations.tokensTotal} + ${s.tokens ?? 0}`,
      })
      .where(eq(investigations.id, s.investigationId));
  return row!;
}

export async function recordStep(s: JournalStep): Promise<AtlasActionRow> {
  return withTenant(s.tenantId, (tx) => recordStepTx(tx, s));
}

/** A line on the timeline for an undo or a redo — written by whoever did it. */
export async function timelineUndoRedoTx(
  tx: Tx,
  tenantId: string,
  row: AtlasActionRow,
  kind: "atlas_undo" | "atlas_redo",
  by: { memberId: string | null; name: string },
): Promise<void> {
  if (!row.incidentId) return;
  await tx.insert(incidentEvents).values({
    tenantId,
    incidentId: row.incidentId,
    kind,
    actorKind: by.memberId ? "member" : "system",
    actorMemberId: by.memberId,
    actorName: by.name,
    payload: { actionId: row.id, title: String(row.payload?.done ?? row.title) },
    occurredAt: new Date(),
  });
}

/** Adds cost to the run without a step of its own (the analysis, the challenger). */
export async function addRunCost(
  tenantId: string,
  investigationId: string,
  costEur: number,
  tokens: number,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(investigations)
      .set({
        costEur: sql`${investigations.costEur} + ${costEur}`,
        tokensTotal: sql`${investigations.tokensTotal} + ${tokens}`,
      })
      .where(eq(investigations.id, investigationId)),
  );
}

/** An audit line under atlas.* — by a member, or by Atlas itself (actor null). */
export async function auditAtlasTx(
  tx: Tx,
  tenantId: string,
  actor: { memberId: string | null; name: string } | null,
  action: string,
  target: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditEvents).values({
    tenantId,
    actorMemberId: actor?.memberId ?? null,
    actorName: actor?.name ?? "Atlas",
    category: "config",
    action,
    target,
  });
}

/** The journal of an incident, in order. */
export async function journalOf(tenantId: string, incidentId: string): Promise<AtlasActionRow[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(atlasActions)
      .where(and(eq(atlasActions.tenantId, tenantId), eq(atlasActions.incidentId, incidentId)))
      .orderBy(atlasActions.at),
  );
}
