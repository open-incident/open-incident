/**
 * Backtesting: today's Atlas replayed on the last 90 days of incidents, with
 * only what was known at the time, and graded against the cause people
 * documented afterwards.
 *
 * For each closed live incident of the window that has a documented cause (a
 * post-mortem's root cause, or a run a person graded right): the material is
 * rebuilt from what existed 15 minutes after the declaration — the alert, the
 * timeline so far, the changes of the six hours before — the analysis runs on
 * it, the fix it would choose among today's allowed actions is asked for, and
 * a grader compares the leading hypothesis with the documented cause. Real
 * model calls, through the configured provider; none configured, no backtest.
 */
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import {
  actionCatalog,
  alerts,
  backtests,
  changeEvents,
  incidentEvents,
  incidents,
  investigations,
  postMortems,
  services,
  withTenant,
  type BacktestStats,
  type InvestigationGrade,
} from "@openincident/db";
import { aiConfigured, ask, parseJson, runCapability, type Actor } from "@openincident/ai";
import { analyse, normaliseAnalysis } from "../engine";
import { choiceMaterial, chooseAction, normaliseChoice } from "./choose";
import { isAvailable, isReversible } from "./executors";
import { maybePromoteTx } from "./ladder";
import { costOf, median, pricesFromEnv } from "./rules";

export const BACKTEST_QUEUE = "atlas-backtest";
export type BacktestJob = { tenantId: string; backtestId: string };

const KNOWN_AFTER_MS = 15 * 60 * 1000;
const MAX_INCIDENTS = 120;
const SYSTEM: Actor = { kind: "system", memberId: null, name: "Atlas backtest" };

const GRADE = `TASK: atlas_backtest_grade. Compare a root cause hypothesis made early in an incident with the cause documented afterwards. Answer with one JSON object {"grade": "bullseye"|"on_target"|"miss"|"nowhere_near", "note": string}. bullseye: same cause, same mechanism. on_target: the right component and direction, details off. miss: a related but wrong cause. nowhere_near: unrelated. One sentence of note.`;

export type BacktestCandidate = {
  id: string;
  number: number;
  name: string;
  serviceId: string;
  declaredAt: Date;
  resolvedAt: Date;
  cause: string;
};

/** The incidents of the window with a cause someone documented. */
export async function backtestCandidates(
  tenantId: string,
  windowDays = 90,
  now = new Date(),
): Promise<BacktestCandidate[]> {
  return withTenant(tenantId, async (tx) => {
    const from = new Date(now.getTime() - windowDays * 86_400_000);
    const rows = await tx
      .select({
        id: incidents.id,
        number: incidents.number,
        name: incidents.name,
        serviceId: incidents.serviceId,
        declaredAt: incidents.declaredAt,
        resolvedAt: incidents.resolvedAt,
        summary: incidents.summary,
        visibility: incidents.visibility,
        pm: postMortems.sections,
        grade: investigations.grade,
        caused: sql<string | null>`${investigations.summary}->>'whatCaused'`,
      })
      .from(incidents)
      .leftJoin(postMortems, eq(postMortems.incidentId, incidents.id))
      .leftJoin(investigations, eq(investigations.incidentId, incidents.id))
      .where(
        and(
          eq(incidents.tenantId, tenantId),
          eq(incidents.mode, "live"),
          isNotNull(incidents.resolvedAt),
          isNotNull(incidents.serviceId),
          gte(incidents.resolvedAt, from),
          lte(incidents.resolvedAt, now),
          eq(incidents.visibility, "public"),
        ),
      )
      .orderBy(desc(incidents.resolvedAt))
      .limit(MAX_INCIDENTS);
    const out: BacktestCandidate[] = [];
    for (const r of rows) {
      const rc = (r.pm ?? []).find((s) => s.key === "root_cause" && s.body.trim().length > 20);
      const graded = r.grade === "bullseye" || r.grade === "on_target" ? r.caused : null;
      const cause = rc?.body ?? graded ?? null;
      if (!cause) continue;
      out.push({
        id: r.id,
        number: r.number,
        name: r.name,
        serviceId: r.serviceId!,
        declaredAt: r.declaredAt,
        resolvedAt: r.resolvedAt!,
        cause: cause.slice(0, 1500),
      });
    }
    return out;
  });
}

/** What was known 15 minutes in: tagged lines, like the live evidence. */
async function materialAt(
  tenantId: string,
  c: BacktestCandidate,
): Promise<{ text: string; known: Set<string> }> {
  const asOf = new Date(c.declaredAt.getTime() + KNOWN_AFTER_MS);
  return withTenant(tenantId, async (tx) => {
    const [svc] = await tx
      .select({ key: services.key })
      .from(services)
      .where(eq(services.id, c.serviceId));
    const evs = await tx
      .select({
        kind: incidentEvents.kind,
        payload: incidentEvents.payload,
        at: incidentEvents.occurredAt,
      })
      .from(incidentEvents)
      .where(and(eq(incidentEvents.incidentId, c.id), lte(incidentEvents.occurredAt, asOf)))
      .orderBy(incidentEvents.occurredAt)
      .limit(30);
    const als = await tx
      .select({ title: alerts.title, at: alerts.firstAt })
      .from(alerts)
      .where(and(eq(alerts.incidentId, c.id), lte(alerts.firstAt, asOf)))
      .limit(10);
    const chs = await tx
      .select({ kind: changeEvents.kind, title: changeEvents.title, at: changeEvents.occurredAt })
      .from(changeEvents)
      .where(
        and(
          eq(changeEvents.tenantId, tenantId),
          eq(changeEvents.serviceId, c.serviceId),
          gte(changeEvents.occurredAt, new Date(c.declaredAt.getTime() - 6 * 3_600_000)),
          lte(changeEvents.occurredAt, asOf),
        ),
      )
      .limit(10);
    const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
    const lines = [
      `INC-${c.number} — ${c.name}`,
      `Service: ${svc?.key ?? "—"} · Declared: ${fmt(c.declaredAt)} · (replay: only what was known at ${fmt(asOf)})`,
      "",
      "## Timeline so far",
    ];
    const known = new Set<string>();
    evs
      .filter((e) => e.kind !== "atlas_action" && e.kind !== "investigation")
      .forEach((e, i) => {
        const id = `E${i + 1}`;
        known.add(id);
        const p = e.payload as Record<string, unknown>;
        const what = [p.title, p.message, p.status]
          .filter((x) => typeof x === "string")
          .join(" — ");
        lines.push(
          `[${id}] ${fmt(e.at)} ${e.kind}${what ? `: ${String(what).slice(0, 240)}` : ""}`,
        );
      });
    lines.push("", "## Alerts");
    als.forEach((a, i) => {
      const id = `A${i + 1}`;
      known.add(id);
      lines.push(`[${id}] ${fmt(a.at)} ${a.title}`);
    });
    lines.push("", "## Changes in the six hours before");
    chs.forEach((ch, i) => {
      const id = `C${i + 1}`;
      known.add(id);
      lines.push(`[${id}] ${fmt(ch.at)} ${ch.kind}: ${ch.title}`);
    });
    return { text: lines.join("\n").slice(0, 16_000), known };
  });
}

const isGrade = (v: unknown): v is InvestigationGrade =>
  v === "bullseye" || v === "on_target" || v === "miss" || v === "nowhere_near";

/** Runs a queued backtest to the end. Progress is written as it goes; a failure is written down. */
export async function runBacktest(job: BacktestJob): Promise<void> {
  const { tenantId, backtestId } = job;
  const prices = pricesFromEnv();
  const [bt] = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(backtests)
      .where(and(eq(backtests.tenantId, tenantId), eq(backtests.id, backtestId))),
  );
  if (!bt || (bt.status !== "queued" && bt.status !== "running")) return;
  if (!aiConfigured()) {
    await withTenant(tenantId, (tx) =>
      tx
        .update(backtests)
        .set({
          status: "failed",
          error: "no inference provider configured",
          completedAt: new Date(),
        })
        .where(eq(backtests.id, backtestId)),
    );
    return;
  }
  const candidates = await backtestCandidates(tenantId, bt.windowDays);
  const actions = await withTenant(tenantId, (tx) =>
    tx.select().from(actionCatalog).where(eq(actionCatalog.tenantId, tenantId)),
  );
  const allowed = actions.filter((a) => a.enabled && isReversible(a) && isAvailable(a));
  await withTenant(tenantId, (tx) =>
    tx
      .update(backtests)
      .set({
        status: "running",
        incidents: candidates.length,
        stats: { done: 0, replayed: candidates.length },
      })
      .where(eq(backtests.id, backtestId)),
  );
  const grades: Record<InvestigationGrade, number> = {
    bullseye: 0,
    on_target: 0,
    miss: 0,
    nowhere_near: 0,
  };
  const perService: Record<string, { incidents: number; right: number }> = {};
  const sooner: number[] = [];
  let cost = 0;
  let done = 0;
  try {
    for (const c of candidates) {
      const m = await materialAt(tenantId, c);
      const analysis = await runCapability(tenantId, "investigate", SYSTEM, null, async () => {
        const { raw, completion } = await analyse(m.text);
        cost += costOf(completion.inputTokens, completion.outputTokens, prices);
        return {
          result: normaliseAnalysis(raw, m.known),
          model: completion.model,
          inputTokens: completion.inputTokens,
          outputTokens: completion.outputTokens,
        };
      });
      const top = analysis.hypotheses.find((h) => h.state !== "contradicted") ?? null;
      let grade: InvestigationGrade = "nowhere_near";
      if (top) {
        grade = await runCapability(tenantId, "investigate", SYSTEM, null, async () => {
          const completion = await ask(
            GRADE,
            `Hypothesis made 15 minutes in: ${top.whatBroke} — ${top.why}\n\nCause documented afterwards: ${c.cause}`,
            { json: true, maxTokens: 150 },
          );
          cost += costOf(completion.inputTokens, completion.outputTokens, prices);
          const g = (parseJson<{ grade?: unknown }>(completion.text) ?? {}).grade;
          return {
            result: isGrade(g) ? g : "miss",
            model: completion.model,
            inputTokens: completion.inputTokens,
            outputTokens: completion.outputTokens,
          };
        });
      }
      grades[grade]++;
      const right = grade === "bullseye" || grade === "on_target";
      const ps = (perService[c.serviceId] ??= { incidents: 0, right: 0 });
      ps.incidents++;
      if (right) ps.right++;
      // Would it have fixed it alone? Right cause, and a fix among today's allowed actions.
      if (right && allowed.length > 0) {
        const choice = await runCapability(tenantId, "investigate", SYSTEM, null, async () => {
          const { raw, completion } = await chooseAction(
            choiceMaterial(
              m.text,
              null,
              analysis.hypotheses,
              analysis.findings,
              allowed.map((a) => ({
                key: a.key,
                label: a.label,
                description: a.description,
                kind: a.executor,
              })),
            ),
          );
          cost += costOf(completion.inputTokens, completion.outputTokens, prices);
          return {
            result: normaliseChoice(
              raw,
              new Set(allowed.map((a) => a.key)),
              new Set([...m.known, ...analysis.findings.map((f) => f.id)]),
            ),
            model: completion.model,
            inputTokens: completion.inputTokens,
            outputTokens: completion.outputTokens,
          };
        });
        if (choice) {
          const people = (c.resolvedAt.getTime() - c.declaredAt.getTime()) / 60_000;
          // Atlas's own time: what it knew at 15 min, plus five to run and verify.
          sooner.push(Math.max(0, people - 20));
        }
      }
      done++;
      await withTenant(tenantId, (tx) =>
        tx
          .update(backtests)
          .set({
            stats: { done, replayed: candidates.length },
            costEur: Math.round(cost * 100) / 100,
          })
          .where(eq(backtests.id, backtestId)),
      );
    }
    const stats: BacktestStats = {
      replayed: candidates.length,
      done,
      resolvedAlone: sooner.length,
      medianMinutesSooner: median(sooner) === null ? null : Math.round(median(sooner)!),
      perService,
    };
    await withTenant(tenantId, async (tx) => {
      await tx
        .update(backtests)
        .set({
          status: "completed",
          grades,
          stats,
          costEur: Math.round(cost * 100) / 100,
          completedAt: new Date(),
        })
        .where(eq(backtests.id, backtestId));
      // The new numbers count toward the levels at once.
      const ids = Object.keys(perService);
      if (ids.length) {
        const svcs = await tx
          .select({ id: services.id })
          .from(services)
          .where(and(eq(services.tenantId, tenantId), inArray(services.id, ids)));
        for (const s of svcs) await maybePromoteTx(tx, tenantId, s.id);
      }
    });
  } catch (err) {
    await withTenant(tenantId, (tx) =>
      tx
        .update(backtests)
        .set({
          status: "failed",
          error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
          costEur: Math.round(cost * 100) / 100,
          completedAt: new Date(),
        })
        .where(eq(backtests.id, backtestId)),
    );
  }
}

/** Queues a backtest: a row now, the job for the worker (or run here, detached, without a queue). */
export async function startBacktest(
  tenantId: string,
  windowDays = 90,
): Promise<{
  id: string;
  incidents: number;
  estimateEur: number | null;
  outcome: "queued" | "inline";
}> {
  const candidates = await backtestCandidates(tenantId, windowDays);
  const runs = await withTenant(tenantId, (tx) =>
    tx
      .select({ cost: investigations.costEur })
      .from(investigations)
      .where(and(eq(investigations.tenantId, tenantId), sql`${investigations.costEur} > 0`))
      .orderBy(desc(investigations.createdAt))
      .limit(200),
  );
  const med = median(runs.map((r) => r.cost));
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .insert(backtests)
      .values({
        tenantId,
        windowDays,
        incidents: candidates.length,
        status: "queued",
        stats: { done: 0 },
      })
      .returning({ id: backtests.id }),
  );
  const job: BacktestJob = { tenantId, backtestId: row!.id };
  const url = process.env.REDIS_URL ?? "redis://localhost:6381";
  let outcome: "queued" | "inline" = "inline";
  try {
    const [{ Queue }, { default: IORedis }] = await Promise.all([
      import("bullmq"),
      import("ioredis"),
    ]);
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    const queue = new Queue(BACKTEST_QUEUE, { connection });
    try {
      await queue.add("run", job, {
        jobId: `bt-${row!.id}`,
        removeOnComplete: true,
        removeOnFail: true,
      });
      outcome = "queued";
    } finally {
      await queue.close().catch(() => {});
      connection.disconnect();
    }
  } catch {
    outcome = "inline";
  }
  if (outcome === "inline")
    void runBacktest(job).catch((err) => console.error("[atlas] backtest failed:", err));
  return {
    id: row!.id,
    incidents: candidates.length,
    estimateEur: med === null ? null : Math.round(med * candidates.length * 0.6 * 100) / 100,
    outcome,
  };
}
