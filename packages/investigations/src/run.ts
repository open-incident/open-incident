/**
 * One assessment, end to end: the evidence, the analysis, the adversarial
 * pass, the row rewritten, a line in the timeline, the synthesis message in
 * the channel updated in place — and the trigger that arrived meanwhile served
 * right after. Failures are written down; earlier results are never erased.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import {
  alertSources,
  alerts,
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
import { runAtlasStep } from "./atlas/engine";
import { httpHost, type AtlasHost } from "./atlas/host";
import { recordStepTx } from "./atlas/journal";
import { costOf, effectiveLevel, pricesFromEnv } from "./atlas/rules";
import { autonomyOfTx, budgetStateTx, incidentFactsTx, readSettingsTx } from "./atlas/state";

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

/**
 * The Atlas gates before a run starts: at the monthly budget, the runs in
 * progress finish and no new one starts; at the cap per run, this incident's
 * run stops re-assessing. Nothing is paged by surprise either way.
 */
async function budgetGate(
  tenantId: string,
  row: Row,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return withTenant(tenantId, async (tx) => {
    const settings = await readSettingsTx(tx, tenantId);
    if (settings.capPerRunEur != null && row.costEur >= settings.capPerRunEur)
      return { ok: false, reason: "cap_per_run" };
    const budget = await budgetStateTx(tx, tenantId, settings);
    if (budget.exhausted && row.runs === 0) return { ok: false, reason: "budget" };
    return { ok: true };
  });
}

/** The journal's first lines of a run, its cost, and the level it started at. */
async function journalAssessment(
  tenantId: string,
  saved: Row,
  trigger: InvestigationTrigger,
  checksDone: number,
  cost: number,
  tokens: number,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const facts = await incidentFactsTx(tx, tenantId, saved.incidentId);
    if (!facts) return;
    const auto = await autonomyOfTx(tx, tenantId, facts.serviceId);
    const level = effectiveLevel(auto.level, auto.cap);
    if (saved.levelAtStart === null)
      await tx
        .update(investigations)
        .set({ levelAtStart: level })
        .where(eq(investigations.id, saved.id));
    const common = {
      tenantId,
      incidentId: saved.incidentId,
      investigationId: saved.id,
      serviceId: facts.serviceId,
      level,
      autonomous: true,
    };
    if (saved.runs === 1) {
      const [src] = await tx
        .select({ name: alertSources.name })
        .from(alerts)
        .innerJoin(alertSources, eq(alertSources.id, alerts.sourceId))
        .where(and(eq(alerts.tenantId, tenantId), eq(alerts.incidentId, saved.incidentId)))
        .orderBy(asc(alerts.firstAt))
        .limit(1);
      await recordStepTx(tx, {
        ...common,
        kind: "read",
        title: src ? `Started on the ${src.name} alert` : "Started on the incident",
        text: src
          ? { key: "atlas.j.startedAlert", params: { source: src.name } }
          : { key: "atlas.j.started" },
        detail: saved.summary?.whatsGoingOn ?? null,
        at: saved.startedAt ?? new Date(),
        costEur: cost * 0.15,
        tokens: Math.round(tokens * 0.15),
      });
      await recordStepTx(tx, {
        ...common,
        kind: "read",
        title: `Ran ${checksDone} checks in parallel`,
        text: { key: "atlas.j.checks", params: { n: checksDone } },
        detail: saved.checks
          .filter((c) => c.status === "done")
          .map((c) => c.kind)
          .join(", "),
        costEur: cost * 0.85,
        tokens: tokens - Math.round(tokens * 0.15),
      });
    } else
      await recordStepTx(tx, {
        ...common,
        kind: "read",
        title: "Re-assessed",
        text: { key: "atlas.j.reassessed", params: { trigger } },
        detail: saved.summary?.whatCaused ?? null,
        costEur: cost,
        tokens,
      });
  });
}

/**
 * Runs one assessment for the incident; safe to call from the worker or
 * inline. `host` is how the Atlas step reaches the product's write paths —
 * the web app passes its own; the worker's default goes through the signed
 * internal route.
 */
export async function runInvestigation(
  job: InvestigationJob,
  opts: { host?: AtlasHost } = {},
): Promise<void> {
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
  const gate = await budgetGate(tenantId, row);
  if (!gate.ok) {
    await fail(tenantId, row, gate.reason);
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

    const prices = pricesFromEnv();
    let spentTokens = 0;
    let spentEur = 0;
    const count = (inT: number, outT: number) => {
      spentTokens += inT + outT;
      spentEur += costOf(inT, outT, prices);
    };
    const first = await runCapability(tenantId, "investigate", actor, incidentId, async () => {
      const { raw, completion } = await analyse(evidence.text);
      count(completion.inputTokens, completion.outputTokens);
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
        count(completion.inputTokens, completion.outputTokens);
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
    await journalAssessment(
      tenantId,
      saved!,
      job.trigger,
      evidence.checks.filter((c) => c.status === "done").length,
      spentEur,
      spentTokens,
    ).catch((err) => console.error("[atlas] journal failed:", err));
    // L0 "Observe" says nothing unless asked: an automatic run stays off the channel.
    const level = await withTenant(tenantId, async (tx) => {
      const a = await autonomyOfTx(tx, tenantId, evidence.incident.serviceId);
      return effectiveLevel(a.level, a.cap);
    }).catch(() => 1);
    const asked = job.trigger === "manual" || job.trigger === "note" || job.trigger === "api";
    if (evidence.incident.mode !== "test" && (level > 0 || asked))
      await postToChat(tenantId, saved!, evidence.incident.number, job.origin).catch((err) =>
        console.error("[investigation] chat post failed:", err),
      );
    // Then the Atlas step: a fix among the allowed actions, within the service's level.
    if (evidence.incident.mode === "live")
      await runAtlasStep({
        tenantId,
        incidentId,
        evidenceText: evidence.text,
        known,
        actor: { kind: "system", memberId: null, name: "Atlas" },
        host: opts.host ?? httpHost(),
      }).catch((err) => console.error("[atlas] step failed:", err));
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
  if (pending) await runInvestigation({ ...job, trigger: pending, actor: undefined }, opts);
}
