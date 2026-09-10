/**
 * One assessment, end to end: the evidence, the analysis, the adversarial
 * pass, the row rewritten, a line in the timeline, the synthesis message in
 * the channel updated in place — and the trigger that arrived meanwhile served
 * right after. Failures are written down; earlier results are never erased.
 */
import { eq, sql } from "drizzle-orm";
import {
  incidentEvents,
  investigations,
  withTenant,
  type Citation,
  type InvestigationTrigger,
} from "@openincident/db";
import { aiProviderLabel, capabilityAllowed, runCapability, type Actor } from "@openincident/ai";
import { postInvestigationAll, type InvestigationView } from "@openincident/chat";
import { gatherEvidence } from "./evidence";
import { analyse, applyChallenge, challenge, composeSummary, normaliseAnalysis } from "./engine";

export const INVESTIGATION_QUEUE = "investigation";

export type InvestigationJob = {
  tenantId: string;
  incidentId: string;
  trigger: InvestigationTrigger;
  /** The workspace's public origin, for the links in the channel. */
  origin: string;
  actor?: Actor;
};

const SYSTEM: Actor = { kind: "system", memberId: null, name: "system" };

type Row = typeof investigations.$inferSelect;

/**
 * The incident's row, queued for `trigger`. A running assessment is not
 * interrupted: the trigger is parked on the row and served when it ends.
 */
export async function ensureInvestigationRow(
  tenantId: string,
  incidentId: string,
  trigger: InvestigationTrigger,
): Promise<Row> {
  return withTenant(tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(investigations)
      .where(eq(investigations.incidentId, incidentId));
    const now = new Date();
    if (existing) {
      if (existing.status === "running") {
        await tx
          .update(investigations)
          .set({ pendingTrigger: trigger, updatedAt: now })
          .where(eq(investigations.id, existing.id));
        return { ...existing, pendingTrigger: trigger };
      }
      const [row] = await tx
        .update(investigations)
        .set({ status: "queued", trigger, error: null, updatedAt: now })
        .where(eq(investigations.id, existing.id))
        .returning();
      return row!;
    }
    const [row] = await tx
      .insert(investigations)
      .values({ tenantId, incidentId, status: "queued", trigger })
      .returning();
    return row!;
  });
}

async function appendEvent(
  tenantId: string,
  incidentId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.insert(incidentEvents).values({
      tenantId,
      incidentId,
      kind: "investigation",
      actorKind: "system",
      actorMemberId: null,
      actorName: null,
      payload,
      occurredAt: new Date(),
    }),
  ).catch((err) => console.error("[investigation] timeline event failed:", err));
}

/** A failed assessment keeps the previous results on screen; only the error changes. */
async function fail(tenantId: string, row: Row, error: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(investigations)
      .set({
        status: row.runs > 0 ? "completed" : "failed",
        error: error.slice(0, 300),
        updatedAt: new Date(),
      })
      .where(eq(investigations.id, row.id)),
  );
}

async function postToChat(
  tenantId: string,
  row: Row,
  number: number,
  origin: string,
): Promise<void> {
  const top = row.hypotheses.find((h) => h.id === row.summary?.topHypothesisId) ?? null;
  const view: InvestigationView = {
    reference: `INC-${number}`,
    url: `${origin}/app/incidents/${number}?tab=investigation`,
    incidentId: row.incidentId,
    whatsGoingOn: row.summary?.whatsGoingOn ?? "",
    whatCaused: row.summary?.whatCaused ?? null,
    confidence: top?.confidence ?? null,
    nextSteps: row.summary?.nextSteps ?? [],
    findings: row.findings.length,
    hypotheses: row.hypotheses.length,
    runs: row.runs,
  };
  const ref = await postInvestigationAll(tenantId, row.incidentId, view, row.chatRef ?? null);
  if (ref && JSON.stringify(ref) !== JSON.stringify(row.chatRef ?? null)) {
    await withTenant(tenantId, (tx) =>
      tx.update(investigations).set({ chatRef: ref }).where(eq(investigations.id, row.id)),
    );
  }
}

/** Runs one assessment for the incident; safe to call from the worker or inline. */
export async function runInvestigation(job: InvestigationJob): Promise<void> {
  const { tenantId, incidentId } = job;
  const actor = job.actor ?? SYSTEM;
  const row = await withTenant(tenantId, async (tx) => {
    const [r] = await tx
      .select()
      .from(investigations)
      .where(eq(investigations.incidentId, incidentId));
    return r ?? null;
  });
  if (!row) return;
  // Paused: the automatic triggers stop; a person asking for one still gets it.
  if (row.paused && (job.trigger === "signal" || job.trigger === "declaration")) {
    if (row.status === "queued")
      await withTenant(tenantId, (tx) =>
        tx
          .update(investigations)
          .set({ status: row.runs > 0 ? "completed" : "failed", error: "paused" })
          .where(eq(investigations.id, row.id)),
      );
    return;
  }
  const allowance = await withTenant(tenantId, (tx) =>
    capabilityAllowed(tx, tenantId, "investigate"),
  );
  if (!allowance.ok) {
    await fail(tenantId, row, allowance.reason);
    return;
  }
  await withTenant(tenantId, (tx) =>
    tx
      .update(investigations)
      .set({
        status: "running",
        trigger: job.trigger,
        startedAt: new Date(),
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(investigations.id, row.id)),
  );

  try {
    const evidence = await gatherEvidence(tenantId, incidentId, row.notes, actor, job.origin);
    if (!evidence) throw new Error("incident_not_found");
    const known = new Set(evidence.items.map((i) => i.id));

    const first = await runCapability(tenantId, "investigate", actor, incidentId, async () => {
      const { raw, completion } = await analyse(evidence.text);
      return {
        result: { analysis: normaliseAnalysis(raw, known), model: completion.model },
        model: completion.model,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
      };
    });
    let hyps = first.analysis.hypotheses;
    if (hyps.length > 0) {
      const before = hyps;
      hyps = await runCapability(tenantId, "investigate", actor, incidentId, async () => {
        const { raw, completion } = await challenge(evidence.text, first.analysis.findings, before);
        return {
          result: applyChallenge(before, raw, known),
          model: completion.model,
          inputTokens: completion.inputTokens,
          outputTokens: completion.outputTokens,
        };
      });
    }
    const summary = composeSummary(first.analysis.whatsGoingOn, hyps, evidence.incident.name);
    const top = hyps.find((h) => h.id === summary.topHypothesisId) ?? null;
    const citations: Citation[] = evidence.items.map(({ id, kind, label, url }) => ({
      id,
      kind,
      label,
      url,
    }));
    const now = new Date();
    const [saved] = await withTenant(tenantId, (tx) =>
      tx
        .update(investigations)
        .set({
          status: "completed",
          runs: sql`${investigations.runs} + 1`,
          triage: first.analysis.triage,
          summary,
          hypotheses: hyps,
          findings: first.analysis.findings,
          citations,
          checks: evidence.checks,
          blastRadius: first.analysis.blastRadius,
          model: first.model,
          provider: aiProviderLabel(),
          completedAt: now,
          updatedAt: now,
          error: null,
        })
        .where(eq(investigations.id, row.id))
        .returning(),
    );
    await appendEvent(tenantId, incidentId, {
      status: "completed",
      trigger: job.trigger,
      runs: saved!.runs,
      hypotheses: hyps.length,
      findings: first.analysis.findings.length,
      confidence: top?.confidence ?? null,
      headline: top?.whatBroke ?? null,
    });
    if (evidence.incident.mode !== "test")
      await postToChat(tenantId, saved!, evidence.incident.number, job.origin).catch((err) =>
        console.error("[investigation] chat post failed:", err),
      );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[investigation] assessment failed:", message);
    await fail(tenantId, row, message);
    await appendEvent(tenantId, incidentId, {
      status: "failed",
      trigger: job.trigger,
      error: message.slice(0, 200),
    });
  }

  // A trigger that landed during the run is served now, once.
  const pending = await withTenant(tenantId, async (tx) => {
    const [r] = await tx
      .select({ pendingTrigger: investigations.pendingTrigger })
      .from(investigations)
      .where(eq(investigations.id, row.id));
    if (!r?.pendingTrigger) return null;
    await tx
      .update(investigations)
      .set({ pendingTrigger: null })
      .where(eq(investigations.id, row.id));
    return r.pendingTrigger;
  });
  if (pending) await runInvestigation({ ...job, trigger: pending, actor: undefined });
}
