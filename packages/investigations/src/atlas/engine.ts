/**
 * The Atlas step — what happens after the analysis (spec delta §15.3).
 *
 *   1. the gates: an open live incident on a service, a run that is not
 *      paused, no kill switch, the cap per run not reached, one fix at a time;
 *   2. a fix chosen among the allowed actions (and only them), then
 *      challenged by an adversarial pass;
 *   3. the policy of the effective level min(level, cap), the rule's
 *      directive and the guardrails — `decidePolicy` in rules.ts;
 *   4. L2 (or any guardrail, any doubt): a proposal a person approves from
 *      the web, the chat or the phone. L3: run it now and page a person at
 *      the same moment. L4: run it; once verified, resolve, and tell people
 *      afterwards the way each of them chose;
 *   5. verification, by the sweep: the automation's verify endpoint, or the
 *      incident's alerts clearing. Not verified in time: a person is paged.
 *
 * Every step is a journal row and a timeline line, with its cost.
 */
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import {
  alerts,
  atlasActions,
  investigations,
  withTenant,
  type Finding,
  type Hypothesis,
  type InvestigationSummary,
} from "@openincident/db";
import { aiProviderLabel, runCapability, type Actor as AiActor } from "@openincident/ai";
import { postAtlasActed } from "@openincident/chat";
import {
  challengeAction,
  choiceMaterial,
  chooseAction,
  normaliseChoice,
  normaliseVerdict,
} from "./choose";
import {
  callExecutor,
  isAvailable,
  isReversible,
  targetAllowed,
  type ActionRow,
} from "./executors";
import type { AtlasHost } from "./host";
import { tenantPublicOrigin } from "./host";
import {
  addCostTx,
  auditAtlasTx,
  mirrorToTimelineTx,
  recordStepTx,
  type AtlasActionRow,
} from "./journal";
import {
  costOf,
  decidePolicy,
  guardrailHits,
  pricesFromEnv,
  UNDO_WINDOW_MS,
  type PolicyDecision,
} from "./rules";
import { signLink } from "./sign";
import {
  autonomyOfTx,
  changeFreezeTx,
  directiveOfTx,
  firstUseOnServiceTx,
  incidentFactsTx,
  liveActionsTx,
  listActionsTx,
  readSettingsTx,
  systemAttemptsTx,
  type IncidentFacts,
} from "./state";

/** How long a fix has to show it worked before a person is paged. */
export const VERIFY_WINDOW_MS = 15 * 60 * 1000;
/** A run proposes or runs at most this many fixes on one incident. */
const MAX_FIXES_PER_INCIDENT = 2;

export type AtlasStepInput = {
  tenantId: string;
  incidentId: string;
  /** The evidence the analysis read, tagged with ids — the material of the choice. */
  evidenceText: string;
  known: Set<string>;
  actor: AiActor;
  host: AtlasHost;
};

export type AtlasStepOutcome =
  | { outcome: "skipped"; reason: string }
  | { outcome: "no_fix" }
  | { outcome: "proposed"; actionId: string; decision: PolicyDecision }
  | { outcome: "acted"; actionId: string; decision: PolicyDecision }
  | { outcome: "failed"; actionId: string; error: string };

const prices = () => pricesFromEnv();
const eur = (inT: number, outT: number) => costOf(inT, outT, prices());

/** Links that work without a session: in a page, a push, a chat message. */
export async function atlasLinks(
  tenantId: string,
  incident: { id: string; number: number },
  actionId: string | null,
  memberId: string | null,
) {
  const origin = await tenantPublicOrigin(tenantId);
  const link = (op: "undo" | "approve" | "stop", id: string) =>
    `${origin}/ack/atlas/${signLink({ t: tenantId, op, id, m: memberId }, UNDO_WINDOW_MS)}`;
  return {
    open: `${origin}/app/incidents/${incident.number}?tab=atlas`,
    undo: actionId ? link("undo", actionId) : undefined,
    approve: actionId ? link("approve", actionId) : undefined,
    stop: link("stop", incident.id),
  };
}

export async function runAtlasStep(input: AtlasStepInput): Promise<AtlasStepOutcome> {
  const { tenantId, incidentId } = input;
  const state = await withTenant(tenantId, async (tx) => {
    const facts = await incidentFactsTx(tx, tenantId, incidentId);
    if (!facts) return null;
    const [inv] = await tx
      .select()
      .from(investigations)
      .where(and(eq(investigations.tenantId, tenantId), eq(investigations.incidentId, incidentId)));
    const settings = await readSettingsTx(tx, tenantId);
    const autonomy = await autonomyOfTx(tx, tenantId, facts.serviceId);
    const directive = await directiveOfTx(tx, tenantId, incidentId);
    const actions = await listActionsTx(tx, tenantId);
    const live = await liveActionsTx(tx, tenantId, incidentId);
    const attempts = await systemAttemptsTx(tx, tenantId, incidentId);
    return { facts, inv: inv ?? null, settings, autonomy, directive, actions, live, attempts };
  });
  if (!state) return { outcome: "skipped", reason: "incident_not_found" };
  const { facts, inv, settings, autonomy, directive, actions } = state;
  if (!inv) return { outcome: "skipped", reason: "no_run" };
  if (facts.mode !== "live") return { outcome: "skipped", reason: "not_live" };
  if (facts.phase !== "triage" && facts.phase !== "active")
    return { outcome: "skipped", reason: "not_open" };
  if (!facts.serviceId) return { outcome: "skipped", reason: "no_service" };
  if (inv.paused) return { outcome: "skipped", reason: "paused" };
  if (settings.killSwitch) return { outcome: "skipped", reason: "kill_switch" };
  if (settings.capPerRunEur != null && inv.costEur >= settings.capPerRunEur)
    return { outcome: "skipped", reason: "cap_per_run" };
  if (state.live.length > 0) return { outcome: "skipped", reason: "fix_in_flight" };
  if (state.attempts >= MAX_FIXES_PER_INCIDENT) return { outcome: "skipped", reason: "attempts" };

  // Below L2, or a rule that says never: Atlas investigates, and that is all.
  const pre = decidePolicy({
    level: autonomy.level,
    cap: autonomy.cap,
    directive,
    killSwitch: false,
    action: { minLevel: 0, reversible: true, enabled: true, available: true },
    hits: [],
    challenger: "holds",
  });
  if (pre.mode === "observe" || pre.mode === "investigate")
    return { outcome: "skipped", reason: pre.reasons[0] ?? "level" };

  const candidates = actions.filter((a) => a.enabled && isReversible(a) && isAvailable(a));
  if (candidates.length === 0) return { outcome: "skipped", reason: "no_allowed_action" };

  const material = choiceMaterial(
    input.evidenceText,
    inv.summary as InvestigationSummary | null,
    inv.hypotheses as Hypothesis[],
    inv.findings as Finding[],
    candidates.map((a) => ({
      key: a.key,
      label: a.label,
      description: a.description,
      kind: a.executor,
    })),
  );
  const known = new Set([...input.known, ...(inv.findings as Finding[]).map((f) => f.id)]);
  const chosen = await runCapability(tenantId, "investigate", input.actor, incidentId, async () => {
    const { raw, completion } = await chooseAction(material);
    return {
      result: {
        choice: normaliseChoice(raw, new Set(candidates.map((a) => a.key)), known),
        tokens: completion.inputTokens + completion.outputTokens,
        cost: eur(completion.inputTokens, completion.outputTokens),
      },
      model: completion.model,
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
    };
  });
  const choice = chosen.choice;
  const action = choice ? (candidates.find((a) => a.key === choice.actionKey) ?? null) : null;
  if (!choice || !action || !targetAllowed(action, choice.target)) {
    await withTenant(tenantId, async (tx) => {
      // Said once per incident: Atlas looked for a fix in the allowed actions and found none.
      const [already] = await tx
        .select({ id: atlasActions.id })
        .from(atlasActions)
        .where(
          and(
            eq(atlasActions.incidentId, incidentId),
            sql`${atlasActions.payload}->'text'->>'key' = 'atlas.j.noFix'`,
          ),
        )
        .limit(1);
      if (already) {
        await tx
          .update(investigations)
          .set({
            costEur: sql`${investigations.costEur} + ${chosen.cost}`,
            tokensTotal: sql`${investigations.tokensTotal} + ${chosen.tokens}`,
          })
          .where(eq(investigations.id, inv.id));
        return;
      }
      await recordStepTx(tx, {
        tenantId,
        incidentId,
        investigationId: inv.id,
        serviceId: facts.serviceId,
        kind: "read",
        title: "No allowed action fits — proposed as a follow-up",
        text: { key: "atlas.j.noFix" },
        detail: (inv.summary as InvestigationSummary | null)?.nextSteps?.[0] ?? null,
        level: pre.effective,
        autonomous: true,
        costEur: chosen.cost,
        tokens: chosen.tokens,
      });
    });
    return { outcome: "no_fix" };
  }

  const challenged = await runCapability(
    tenantId,
    "investigate",
    input.actor,
    incidentId,
    async () => {
      const { raw, completion } = await challengeAction(material, choice);
      return {
        result: {
          verdict: normaliseVerdict(raw, known),
          tokens: completion.inputTokens + completion.outputTokens,
          cost: eur(completion.inputTokens, completion.outputTokens),
        },
        model: completion.model,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
      };
    },
  );

  const facts2 = await withTenant(tenantId, async (tx) => ({
    firstUse: await firstUseOnServiceTx(tx, tenantId, facts.serviceId, action.key),
    freeze: await changeFreezeTx(tx, tenantId, facts.serviceId),
  }));
  const hits = guardrailHits(settings.guardrails, {
    sev1: facts.severityRank === 0,
    acknowledged: facts.acknowledgedAt !== null,
    securityOrPrivate: facts.privateType || facts.visibility === "private",
    firstUseOnService: facts2.firstUse,
    changeFreeze: facts2.freeze,
  });
  const decision = decidePolicy({
    level: autonomy.level,
    cap: autonomy.cap,
    directive,
    killSwitch: settings.killSwitch,
    action: {
      minLevel: action.minLevel,
      reversible: isReversible(action),
      enabled: action.enabled,
      available: isAvailable(action),
    },
    hits,
    challenger: challenged.verdict.verdict,
  });
  const cost = chosen.cost + challenged.cost;
  const tokens = chosen.tokens + challenged.tokens;
  const common = {
    todo: choice.todo,
    done: choice.done,
    target: choice.target,
    rationale: choice.rationale,
    verify: choice.verify,
    citations: choice.citations,
    challenger: challenged.verdict.verdict,
    challengerNote: challenged.verdict.note,
    reasons: decision.reasons,
    guardrails: hits,
    provider: aiProviderLabel(),
  };

  if (decision.mode === "observe" || decision.mode === "investigate") {
    // The challenger contradicted the fix (or a switch moved meanwhile): say so, run nothing.
    await withTenant(tenantId, (tx) =>
      recordStepTx(tx, {
        tenantId,
        incidentId,
        investigationId: inv.id,
        serviceId: facts.serviceId,
        kind: "read",
        actionKey: action.key,
        title: `Considered: ${choice.todo}`,
        text: { key: "atlas.j.considered", params: { what: choice.todo } },
        detail: challenged.verdict.note || null,
        level: decision.effective,
        autonomous: true,
        costEur: cost,
        tokens,
        payload: common,
      }),
    );
    return { outcome: "no_fix" };
  }

  if (decision.mode === "propose")
    return propose(input, facts, inv.id, action, decision, common, cost, tokens);
  return act(input, facts, inv.id, action, decision, common, cost, tokens, settings.executorNonce);
}

async function propose(
  input: AtlasStepInput,
  facts: IncidentFacts,
  investigationId: string,
  action: ActionRow,
  decision: PolicyDecision,
  common: Record<string, unknown> & { todo: string },
  cost: number,
  tokens: number,
): Promise<AtlasStepOutcome> {
  const { tenantId, incidentId } = input;
  const now = new Date();
  const row = await withTenant(tenantId, async (tx) => {
    const r = await recordStepTx(tx, {
      tenantId,
      incidentId,
      investigationId,
      serviceId: facts.serviceId,
      kind: "system",
      actionKey: action.key,
      title: `Proposed: ${common.todo}`,
      text: { key: "atlas.j.proposed", params: { what: common.todo } },
      detail: action.description,
      level: decision.effective,
      reversible: true,
      approvalState: "waiting",
      approvalRequestedAt: now,
      costEur: cost,
      tokens,
      payload: common,
    });
    await auditAtlasTx(tx, tenantId, null, "atlas.proposed", {
      incident: facts.number,
      service: facts.serviceKey,
      level: decision.effective,
      action: common.todo,
      reasons: decision.reasons,
    });
    return r;
  });
  // At L4 nobody was being paged: a fix that waits for a person needs that person now.
  if (decision.effective >= 4)
    await input.host.run({
      op: "page",
      tenantId,
      incidentId,
      reason: "blocked",
      note: common.todo,
    });
  await input.host.run({ op: "notify", tenantId, kind: "proposal", incidentId, actionId: row.id });
  return { outcome: "proposed", actionId: row.id, decision };
}

async function act(
  input: AtlasStepInput,
  facts: IncidentFacts,
  investigationId: string,
  action: ActionRow,
  decision: PolicyDecision,
  common: Record<string, unknown> & { todo: string; done: string; target: string | null },
  cost: number,
  tokens: number,
  nonce: string,
): Promise<AtlasStepOutcome> {
  const { tenantId, incidentId } = input;
  // The journal row exists before the call, so the automation's idempotency key is real.
  const pending = await withTenant(tenantId, (tx) =>
    tx
      .insert(atlasActions)
      .values({
        tenantId,
        investigationId,
        incidentId,
        serviceId: facts.serviceId,
        kind: "system",
        actionKey: action.key,
        title: common.done,
        detail: action.description,
        payload: { ...common, executing: true },
        decidedBy: "atlas",
        level: decision.effective,
        autonomous: true,
        reversible: true,
        costEur: Math.round(cost * 10_000) / 10_000,
        tokens,
      })
      .returning(),
  );
  const row = pending[0]!;
  const res = await callExecutor({
    tenantId,
    nonce,
    action,
    phase: "do",
    actionId: row.id,
    incident: {
      number: facts.number,
      title: facts.name,
      service: facts.serviceKey,
      severity: facts.severity,
    },
    target: common.target,
  });
  if (!res.ok) {
    await withTenant(tenantId, async (tx) => {
      const [r] = await tx
        .update(atlasActions)
        .set({
          title: `Could not run: ${common.todo}`.slice(0, 300),
          detail: res.error,
          reversible: false,
          payload: {
            ...common,
            error: res.error,
            text: { key: "atlas.j.failed", params: { what: common.todo } },
          },
        })
        .where(eq(atlasActions.id, row.id))
        .returning();
      await mirrorToTimelineTx(tx, r!);
      await addCostTx(tx, investigationId, cost, tokens);
      await auditAtlasTx(tx, tenantId, null, "atlas.failed", {
        incident: facts.number,
        service: facts.serviceKey,
        action: common.todo,
        error: res.error,
      });
    });
    await input.host.run({ op: "page", tenantId, incidentId, reason: "failed", note: res.error });
    return { outcome: "failed", actionId: row.id, error: res.error };
  }
  const now = new Date();
  const done = await withTenant(tenantId, async (tx) => {
    const [r] = await tx
      .update(atlasActions)
      .set({
        executedAt: now,
        detail: res.detail ?? action.description,
        payload: {
          ...common,
          ref: res.ref,
          verifyBy: new Date(now.getTime() + VERIFY_WINDOW_MS).toISOString(),
        },
      })
      .where(eq(atlasActions.id, row.id))
      .returning();
    await mirrorToTimelineTx(tx, r!);
    await addCostTx(tx, investigationId, cost, tokens);
    return r!;
  });
  let paged: string | null = null;
  if (decision.mode === "act_and_page") {
    const p = await input.host.run({
      op: "page",
      tenantId,
      incidentId,
      reason: "acted",
      note: common.done,
    });
    paged = typeof p.data?.paged === "string" ? p.data.paged : null;
    await withTenant(tenantId, (tx) =>
      recordStepTx(tx, {
        tenantId,
        incidentId,
        investigationId,
        serviceId: facts.serviceId,
        kind: "oi_write",
        title: paged ? `Paged ${paged}` : "Paged the escalation policy",
        text: paged
          ? { key: "atlas.j.paged", params: { member: paged } }
          : { key: "atlas.j.pagedPolicy" },
        detail: p.ok ? null : (p.error ?? null),
        level: decision.effective,
        autonomous: true,
        payload: { ok: p.ok },
      }),
    );
  }
  await withTenant(tenantId, (tx) =>
    auditAtlasTx(tx, tenantId, null, "atlas.acted", {
      incident: facts.number,
      service: facts.serviceKey,
      level: decision.effective,
      action: common.done,
      paged,
    }),
  );
  const links = await atlasLinks(tenantId, facts, done.id, null);
  await postAtlasActed({
    tenantId,
    incidentId,
    actionId: done.id,
    level: decision.effective,
    title: common.done,
    detail: res.detail ?? action.description,
    reversible: true,
    urls: { open: links.open, undo: links.undo, stop: links.stop },
  }).catch((err) => console.error("[atlas] chat post failed:", err));
  return { outcome: "acted", actionId: done.id, decision };
}

/* ---------- Verification and the autonomous resolution ---------- */

/**
 * The sweep's pass over fixes that ran and are not verified yet: asks the
 * automation (or reads the incident's alerts), and on success — for a fix
 * Atlas ran alone — resolves the incident. Out of time: a person is paged.
 */
export async function verifyPending(
  tenantId: string,
  host: AtlasHost,
  now = new Date(),
): Promise<number> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(atlasActions)
      .where(
        and(
          eq(atlasActions.tenantId, tenantId),
          eq(atlasActions.kind, "system"),
          isNotNull(atlasActions.executedAt),
          isNull(atlasActions.verifiedAt),
          isNull(atlasActions.undoneAt),
          lt(atlasActions.executedAt, new Date(now.getTime() - 20_000)),
          sql`coalesce((${atlasActions.payload}->>'verifyGaveUp')::boolean, false) = false`,
        ),
      )
      .limit(20),
  );
  let n = 0;
  for (const row of rows) {
    try {
      if (await verifyOne(tenantId, row, host, now)) n++;
    } catch (err) {
      console.error("[atlas] verification failed:", err);
    }
  }
  return n;
}

async function verifyOne(
  tenantId: string,
  row: AtlasActionRow,
  host: AtlasHost,
  now: Date,
): Promise<boolean> {
  if (!row.incidentId) return false;
  const ctx = await withTenant(tenantId, async (tx) => ({
    facts: await incidentFactsTx(tx, tenantId, row.incidentId!),
    settings: await readSettingsTx(tx, tenantId),
    actions: await listActionsTx(tx, tenantId),
    firing: await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(alerts)
      .where(
        and(
          eq(alerts.tenantId, tenantId),
          eq(alerts.incidentId, row.incidentId!),
          eq(alerts.status, "firing"),
        ),
      )
      .then((r) => r[0]?.n ?? 0),
    attached: await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(alerts)
      .where(and(eq(alerts.tenantId, tenantId), eq(alerts.incidentId, row.incidentId!)))
      .then((r) => r[0]?.n ?? 0),
  }));
  if (!ctx.facts) return false;
  const action = ctx.actions.find((a) => a.key === row.actionKey) ?? null;
  let healthy: boolean | null = null;
  let how = "";
  if (action && action.limits?.http && (action.limits.http as { verifyUrl?: string }).verifyUrl) {
    const r = await callExecutor({
      tenantId,
      nonce: ctx.settings.executorNonce,
      action,
      phase: "verify",
      actionId: row.id,
      incident: {
        number: ctx.facts.number,
        title: ctx.facts.name,
        service: ctx.facts.serviceKey,
        severity: ctx.facts.severity,
      },
      target: typeof row.payload?.target === "string" ? row.payload.target : null,
    });
    healthy = r.ok ? r.healthy : null;
    how = r.ok ? (r.detail ?? "") : r.error;
  }
  if (healthy === null && ctx.attached > 0) {
    healthy = ctx.firing === 0;
    how = healthy
      ? "every alert of the incident has cleared"
      : `${ctx.firing} alert(s) still firing`;
  }
  const deadline =
    Date.parse(String(row.payload?.verifyBy ?? "")) || row.executedAt!.getTime() + VERIFY_WINDOW_MS;
  if (healthy !== true) {
    if (now.getTime() < deadline) return false;
    // Out of time: a person takes over.
    await withTenant(tenantId, async (tx) => {
      await tx
        .update(atlasActions)
        .set({ payload: { ...row.payload, verifyGaveUp: true } })
        .where(eq(atlasActions.id, row.id));
      await recordStepTx(tx, {
        tenantId,
        incidentId: row.incidentId!,
        investigationId: row.investigationId,
        serviceId: row.serviceId,
        kind: "read",
        title: "Recovery not verified",
        text: { key: "atlas.j.notVerified" },
        detail: how || null,
        level: row.level,
        autonomous: true,
      });
    });
    if (row.autonomous)
      await host.run({
        op: "page",
        tenantId,
        incidentId: row.incidentId,
        reason: "failed",
        note: how || "not verified",
      });
    return true;
  }
  const verifiedAt = new Date();
  const resolveNow =
    row.autonomous &&
    (row.level ?? 0) >= 3 &&
    !ctx.settings.killSwitch &&
    (ctx.facts.phase === "triage" || ctx.facts.phase === "active");
  await withTenant(tenantId, async (tx) => {
    await tx.update(atlasActions).set({ verifiedAt }).where(eq(atlasActions.id, row.id));
    await recordStepTx(tx, {
      tenantId,
      incidentId: row.incidentId!,
      investigationId: row.investigationId,
      serviceId: row.serviceId,
      kind: "read",
      title: "Verified recovery",
      text: { key: "atlas.j.verified" },
      detail: how || null,
      level: row.level,
      autonomous: true,
      at: verifiedAt,
    });
  });
  if (resolveNow) await resolveByAtlas(tenantId, row, ctx.facts, host);
  return true;
}

/**
 * Atlas resolves: through the product's own path (host), then the journal
 * says so (reversible — the undo reopens), the run waits for review, the
 * audit log has the line, and — at L4, where nobody was paged — the members
 * hear about it the way each of them chose.
 */
async function resolveByAtlas(
  tenantId: string,
  row: AtlasActionRow,
  facts: IncidentFacts,
  host: AtlasHost,
): Promise<void> {
  const alone = (row.level ?? 0) >= 4;
  const paged = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: atlasActions.id })
      .from(atlasActions)
      .where(
        and(
          eq(atlasActions.incidentId, row.incidentId!),
          sql`${atlasActions.payload}->'text'->>'key' in ('atlas.j.paged', 'atlas.j.pagedPolicy')`,
        ),
      )
      .limit(1),
  );
  const nobodyPaged = alone && paged.length === 0;
  const message = String(row.payload?.done ?? row.title);
  const r = await host.run({
    op: "resolve",
    tenantId,
    incidentId: row.incidentId!,
    message,
    alone: nobodyPaged,
  });
  if (!r.ok) {
    await host.run({
      op: "page",
      tenantId,
      incidentId: row.incidentId!,
      reason: "failed",
      note: r.error ?? "could not resolve",
    });
    return;
  }
  const resolved = await withTenant(tenantId, async (tx) => {
    const step = await recordStepTx(tx, {
      tenantId,
      incidentId: row.incidentId!,
      investigationId: row.investigationId,
      serviceId: row.serviceId,
      kind: "oi_write",
      title: `Resolved INC-${facts.number} and wrote the summary`,
      text: { key: "atlas.j.resolved", params: { incident: `INC-${facts.number}` } },
      detail: message,
      level: row.level,
      autonomous: true,
      reversible: true,
      payload: { op: "resolve", alone: nobodyPaged },
    });
    if (row.investigationId)
      await tx
        .update(investigations)
        .set({ resolvedAlone: nobodyPaged, reviewState: "pending", updatedAt: new Date() })
        .where(eq(investigations.id, row.investigationId));
    await auditAtlasTx(tx, tenantId, null, "atlas.resolved", {
      incident: facts.number,
      service: facts.serviceKey,
      level: row.level,
      alone: nobodyPaged,
      undoUntil: new Date(Date.now() + UNDO_WINDOW_MS).toISOString(),
    });
    return step;
  });
  if (nobodyPaged)
    await host.run({
      op: "notify",
      tenantId,
      kind: "resolved",
      incidentId: row.incidentId!,
      actionId: resolved.id,
    });
}

/** The incidents an Atlas run touched and whose journal needs no more action: for tests and tools. */
export async function openFixes(tenantId: string, incidentIds: string[]) {
  if (incidentIds.length === 0) return [];
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(atlasActions)
      .where(
        and(
          eq(atlasActions.tenantId, tenantId),
          inArray(atlasActions.incidentId, incidentIds),
          eq(atlasActions.kind, "system"),
        ),
      ),
  );
}
