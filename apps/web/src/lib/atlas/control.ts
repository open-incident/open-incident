/**
 * Commands on Atlas — CONTRACT shared by the engine, the screens and the chat.
 *
 * Owner: atlas-core. Callers: atlas-ui's buttons (through server actions of
 * their own that check the member and revalidate), the chat commands
 * (`atlas stop`, `atlas stop all`, `atlas approve`), the mobile signed links,
 * Settings › Atlas.
 *
 * Each function takes the acting member (or "chat:<user>" / "link" for the
 * signed paths), writes what it did to the audit log under `atlas.*`, and
 * never trusts its caller for permission — the caller checks first.
 *
 * The work itself lives in @openincident/investigations (atlas/commands.ts),
 * shared with the worker; here it runs with the web app as its host, so an
 * undo that reopens an incident or a review that pages the owner goes
 * through the product's own write paths.
 *
 * A command the state refuses (a proposal already decided, an undo window
 * closed, an endpoint that answered 500) THROWS an `AtlasRefusal` whose
 * message says why in plain words; on success it returns what changed.
 */
import "server-only";
import type { AtlasNotifyMode, AutonomyLevel, InvestigationGrade } from "@openincident/db";
import { atlas } from "@openincident/investigations";
import { webHost } from "./host";

export type AtlasActor = { memberId: string | null; label: string };

/** What a command changed: the level it moved, if any. */
export type AtlasCommandResult = {
  level: { serviceKey: string | null; from: number; to: number } | null;
  /** Partial failures worth saying (a reopen whose undo of one fix failed). */
  note: string | null;
};

export class AtlasRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtlasRefusal";
  }
}

const actor = (by: AtlasActor): atlas.Actor => ({ memberId: by.memberId, name: by.label });

function settle(r: atlas.CommandResult): AtlasCommandResult {
  if (!r.ok) throw new AtlasRefusal(r.error ?? "refused");
  return { level: r.level ?? null, note: r.error ?? null };
}

/** Kill switch — every service, at once. Waiting proposals are withdrawn; nothing more runs. */
export async function setKillSwitch(tenantId: string, on: boolean, by: AtlasActor): Promise<void> {
  await atlas.setKillSwitch(tenantId, on, actor(by));
}

/** Stop on one incident: the run pauses and every proposal still waiting is withdrawn. */
export async function stopIncident(
  tenantId: string,
  incidentId: string,
  by: AtlasActor,
): Promise<number> {
  return atlas.stopIncident(tenantId, incidentId, actor(by));
}

/** Resume on one incident after a Stop or a Pause. */
export async function resumeIncident(
  tenantId: string,
  incidentId: string,
  by: AtlasActor,
): Promise<void> {
  await atlas.resumeIncident(tenantId, incidentId, actor(by));
}

/** An admin's ceiling on a service. Null removes it. Never raises the level itself. */
export async function setServiceCap(
  tenantId: string,
  serviceId: string,
  cap: AutonomyLevel | null,
  by: AtlasActor,
): Promise<void> {
  await atlas.setServiceCap(tenantId, serviceId, cap, actor(by));
}

export async function setNotifyMode(
  tenantId: string,
  memberId: string,
  mode: AtlasNotifyMode,
): Promise<void> {
  await atlas.setNotifyMode(tenantId, memberId, mode);
}

/** Approve a waiting proposal: it runs, is verified, and the journal says who approved. */
export async function approveAction(
  tenantId: string,
  actionId: string,
  by: AtlasActor,
): Promise<AtlasCommandResult> {
  return settle(await atlas.approveAction(tenantId, actionId, actor(by)));
}

/** Reject a waiting proposal. */
export async function rejectAction(
  tenantId: string,
  actionId: string,
  by: AtlasActor,
): Promise<AtlasCommandResult> {
  return settle(await atlas.rejectAction(tenantId, actionId, actor(by)));
}

/** Undo a reversible action (24 h window for an autonomous resolution). Writes its own timeline event; costs the service a level if Atlas took it alone. */
export async function undoAction(
  tenantId: string,
  actionId: string,
  by: AtlasActor,
): Promise<AtlasCommandResult> {
  return settle(await atlas.undoAction(tenantId, actionId, actor(by), webHost));
}

/** Redo what was undone. */
export async function redoAction(
  tenantId: string,
  actionId: string,
  by: AtlasActor,
): Promise<AtlasCommandResult> {
  return settle(await atlas.redoAction(tenantId, actionId, actor(by), webHost));
}

/** Review queue verdicts: Looks right (on_target), Not quite (miss — a Miss costs a level), Reopen (undo what can be, page the owner, service one level down). */
export async function reviewResolution(
  tenantId: string,
  investigationId: string,
  verdict: "ok" | "miss" | "reopen",
  by: AtlasActor,
): Promise<AtlasCommandResult> {
  return settle(
    await atlas.reviewResolution(tenantId, investigationId, verdict, actor(by), webHost),
  );
}

/**
 * A grade after closure (the Atlas tab's Bullseye / On target / Miss /
 * Nowhere near): written on the run, then the ladder moves — Miss one level
 * down, Nowhere near back to L1, a right grade may promote.
 */
export async function gradeRun(
  tenantId: string,
  investigationId: string,
  grade: InvestigationGrade,
  by: AtlasActor,
  note?: string | null,
): Promise<AtlasCommandResult> {
  return settle(await atlas.gradeRunCommand(tenantId, investigationId, grade, actor(by), note));
}

/* ---- Settings › Atlas ---- */

export async function setActionEnabled(
  tenantId: string,
  key: string,
  on: boolean,
  by: AtlasActor,
): Promise<void> {
  settle(await atlas.setActionEnabled(tenantId, key, on, actor(by)));
}

export async function configureAction(
  tenantId: string,
  key: string,
  http: { doUrl: string | null; undoUrl: string | null; verifyUrl: string | null },
  by: AtlasActor,
): Promise<void> {
  settle(await atlas.configureAction(tenantId, key, http, actor(by)));
}

export async function setGuardrail(
  tenantId: string,
  key: atlas.GuardrailKey,
  on: boolean,
  by: AtlasActor,
): Promise<void> {
  settle(await atlas.setGuardrail(tenantId, key, on, actor(by)));
}

export async function setBudget(
  tenantId: string,
  budget: { monthEur: number | null; perRunEur: number | null },
  by: AtlasActor,
): Promise<void> {
  settle(await atlas.setBudget(tenantId, budget, actor(by)));
}

/** A new signing secret for the automation endpoints — returned once, to be shown once. */
export async function rotateExecutorSecret(tenantId: string, by: AtlasActor): Promise<string> {
  return atlas.rotateExecutorSecret(tenantId, actor(by));
}

/** Starts a 90-day backtest; refused without an inference provider. */
export async function startBacktest(
  tenantId: string,
  by: AtlasActor,
): Promise<{ id: string; incidents: number; estimateEur: number | null }> {
  const { aiConfigured } = await import("@openincident/ai");
  if (!aiConfigured()) throw new AtlasRefusal("no inference provider configured");
  const r = await atlas.startBacktest(tenantId, 90);
  const { withTenant } = await import("@openincident/db");
  await withTenant(tenantId, (tx) =>
    atlas.auditAtlasTx(tx, tenantId, actor(by), "atlas.backtest_started", {
      incidents: r.incidents,
      estimate: r.estimateEur,
    }),
  );
  return r;
}
