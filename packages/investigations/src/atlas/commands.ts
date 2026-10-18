/**
 * What people do to Atlas: approve or reject a proposal, undo or redo what it
 * did, review an autonomous resolution, grade a run, stop it on an incident
 * or everywhere, cap a service, shape the allowed actions and the guardrails.
 *
 * Shared by every way in — the screens, the chat commands, the signed links
 * of the phone — so each of them behaves the same and leaves the same trail:
 * a journal row and a timeline line where an incident is concerned, an audit
 * line under atlas.* always. Permission is the caller's to check; these
 * functions refuse what the state does not allow (an expired undo window, a
 * proposal already decided) and say why rather than throwing.
 */
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  actionCatalog,
  atlasActions,
  atlasNotifyPrefs,
  atlasSettings,
  autonomyEvents,
  investigations,
  serviceAutonomy,
  services,
  withTenant,
  type AtlasNotifyMode,
  type AutonomyLevel,
  type InvestigationGrade,
  type Tx,
} from "@openincident/db";
import { callExecutor, isAvailable, isReversible } from "./executors";
import type { AtlasHost } from "./host";
import {
  auditAtlasTx,
  mirrorToTimelineTx,
  recordStepTx,
  timelineUndoRedoTx,
  type AtlasActionRow,
} from "./journal";
import { dropTx, gradeRunTx, type Actor } from "./ladder";
import { GUARDRAILS, UNDO_WINDOW_MS, readGuardrails, type GuardrailKey } from "./rules";
import { executorSecret, newExecutorNonce } from "./sign";
import { incidentFactsTx, readSettingsTx } from "./state";
import { VERIFY_WINDOW_MS } from "./engine";

export type CommandResult = {
  ok: boolean;
  /** Why it was refused or failed, in plain words (shown as is, after the screen's own sentence). */
  error?: string;
  /** A change of level it caused, if any. */
  level?: { serviceKey: string | null; from: number; to: number } | null;
};

const refuse = (error: string): CommandResult => ({ ok: false, error });

async function rowOf(tx: Tx, tenantId: string, actionId: string): Promise<AtlasActionRow | null> {
  const [r] = await tx
    .select()
    .from(atlasActions)
    .where(and(eq(atlasActions.tenantId, tenantId), eq(atlasActions.id, actionId)));
  return r ?? null;
}

async function serviceKeyOf(tx: Tx, serviceId: string | null): Promise<string | null> {
  if (!serviceId) return null;
  const [s] = await tx
    .select({ key: services.key })
    .from(services)
    .where(eq(services.id, serviceId));
  return s?.key ?? null;
}

const todoOf = (r: AtlasActionRow) => String(r.payload?.todo ?? r.title);
const doneOf = (r: AtlasActionRow) => String(r.payload?.done ?? r.title);

/* ---------- Proposals ---------- */

/** A person approves: the fix runs now, through its executor, and is then verified. */
export async function approveAction(
  tenantId: string,
  actionId: string,
  by: Actor,
): Promise<CommandResult> {
  const prep = await withTenant(tenantId, async (tx) => {
    const row = await rowOf(tx, tenantId, actionId);
    if (!row || row.kind !== "system") return { error: "not a proposal" } as const;
    if (row.approvalState !== "waiting")
      return {
        error: `already ${row.approvalState === "approved" ? "approved" : row.approvalState}`,
      } as const;
    const facts = row.incidentId ? await incidentFactsTx(tx, tenantId, row.incidentId) : null;
    if (!facts || (facts.phase !== "triage" && facts.phase !== "active"))
      return { error: "the incident is no longer open" } as const;
    const settings = await readSettingsTx(tx, tenantId);
    const [action] = await tx
      .select()
      .from(actionCatalog)
      .where(and(eq(actionCatalog.tenantId, tenantId), eq(actionCatalog.key, row.actionKey ?? "")));
    if (!action || !isAvailable(action))
      return { error: "this action is unavailable on this instance" } as const;
    // Claimed first, so two taps (web and phone) never run it twice.
    const claimed = await tx
      .update(atlasActions)
      .set({ approvalState: "approved", approvedByMemberId: by.memberId })
      .where(and(eq(atlasActions.id, row.id), eq(atlasActions.approvalState, "waiting")))
      .returning({ id: atlasActions.id });
    if (claimed.length === 0) return { error: "already decided" } as const;
    await recordStepTx(tx, {
      tenantId,
      incidentId: row.incidentId!,
      investigationId: row.investigationId,
      serviceId: row.serviceId,
      kind: "human",
      title: `${by.name} approved: ${todoOf(row)}`,
      text: { key: "atlas.j.approved", params: { member: by.name, what: todoOf(row) } },
      decidedByMemberId: by.memberId,
      actorName: by.name,
      level: row.level,
      payload: { refActionId: row.id },
    });
    await auditAtlasTx(tx, tenantId, by, "atlas.approved", {
      incident: facts.number,
      service: facts.serviceKey,
      action: todoOf(row),
    });
    return { row, facts, action, nonce: settings.executorNonce } as const;
  });
  if ("error" in prep) return refuse(prep.error!);
  const { row, facts, action, nonce } = prep;
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
    target: typeof row.payload?.target === "string" ? row.payload.target : null,
  });
  const now = new Date();
  await withTenant(tenantId, async (tx) => {
    const [r] = await tx
      .update(atlasActions)
      .set(
        res.ok
          ? {
              executedAt: now,
              title: doneOf(row).slice(0, 300),
              detail: res.detail ?? row.detail,
              payload: {
                ...row.payload,
                ref: res.ref,
                approvedAt: now.toISOString(),
                verifyBy: new Date(now.getTime() + VERIFY_WINDOW_MS).toISOString(),
              },
            }
          : {
              detail: res.error,
              payload: { ...row.payload, error: res.error, approvedAt: now.toISOString() },
            },
      )
      .where(eq(atlasActions.id, row.id))
      .returning();
    if (res.ok) await mirrorToTimelineTx(tx, r!);
    else
      await recordStepTx(tx, {
        tenantId,
        incidentId: row.incidentId!,
        investigationId: row.investigationId,
        serviceId: row.serviceId,
        kind: "read",
        title: `Could not run: ${todoOf(row)}`,
        text: { key: "atlas.j.failed", params: { what: todoOf(row) } },
        detail: res.error,
        level: row.level,
        autonomous: true,
      });
  });
  return res.ok ? { ok: true } : refuse(res.error);
}

/** A person rejects: nothing runs; the journal says who and when. */
export async function rejectAction(
  tenantId: string,
  actionId: string,
  by: Actor,
): Promise<CommandResult> {
  return withTenant(tenantId, async (tx) => {
    const row = await rowOf(tx, tenantId, actionId);
    if (!row || row.kind !== "system") return refuse("not a proposal");
    const claimed = await tx
      .update(atlasActions)
      .set({ approvalState: "rejected" })
      .where(and(eq(atlasActions.id, row.id), eq(atlasActions.approvalState, "waiting")))
      .returning({ id: atlasActions.id });
    if (claimed.length === 0) return refuse("already decided");
    await recordStepTx(tx, {
      tenantId,
      incidentId: row.incidentId!,
      investigationId: row.investigationId,
      serviceId: row.serviceId,
      kind: "human",
      title: `${by.name} rejected: ${todoOf(row)}`,
      text: { key: "atlas.j.rejected", params: { member: by.name, what: todoOf(row) } },
      decidedByMemberId: by.memberId,
      actorName: by.name,
      level: row.level,
      payload: { refActionId: row.id },
    });
    await auditAtlasTx(tx, tenantId, by, "atlas.rejected", {
      incident: null,
      service: await serviceKeyOf(tx, row.serviceId),
      action: todoOf(row),
    });
    return { ok: true };
  });
}

/* ---------- Undo / redo ---------- */

/** Whether a row can be undone right now — the rule the buttons and the links share. */
export function undoable(row: AtlasActionRow, now = Date.now()): { ok: boolean; reason?: string } {
  if (row.undoneAt) return { ok: false, reason: "already undone" };
  if (!row.reversible) return { ok: false, reason: "not reversible" };
  const done = row.executedAt ?? (row.kind === "oi_write" ? row.at : null);
  if (!done) return { ok: false, reason: "never ran" };
  if (row.autonomous && now - done.getTime() > UNDO_WINDOW_MS)
    return { ok: false, reason: "the 24 h undo window has closed" };
  return { ok: true };
}

async function applyReverse(
  tenantId: string,
  row: AtlasActionRow,
  phase: "undo" | "do",
  host: AtlasHost,
  by: Actor,
): Promise<{ ok: boolean; error?: string }> {
  if (row.kind === "system") {
    const ctx = await withTenant(tenantId, async (tx) => {
      const [action] = await tx
        .select()
        .from(actionCatalog)
        .where(
          and(eq(actionCatalog.tenantId, tenantId), eq(actionCatalog.key, row.actionKey ?? "")),
        );
      return {
        action: action ?? null,
        facts: row.incidentId ? await incidentFactsTx(tx, tenantId, row.incidentId) : null,
        settings: await readSettingsTx(tx, tenantId),
      };
    });
    if (!ctx.action) return { ok: false, error: "the action is no longer allowed" };
    if (phase === "undo" && !isReversible(ctx.action))
      return { ok: false, error: "no undo endpoint is configured for this action" };
    const res = await callExecutor({
      tenantId,
      nonce: ctx.settings.executorNonce,
      action: ctx.action,
      phase,
      actionId: row.id,
      incident: {
        number: ctx.facts?.number ?? 0,
        title: ctx.facts?.name ?? "",
        service: ctx.facts?.serviceKey ?? null,
        severity: ctx.facts?.severity ?? null,
      },
      target: typeof row.payload?.target === "string" ? row.payload.target : null,
    });
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }
  const op = row.payload?.op;
  if (op === "resolve" && row.incidentId) {
    const r =
      phase === "undo"
        ? await host.run({
            op: "reopen",
            tenantId,
            incidentId: row.incidentId,
            message: `Undone by ${by.name}`,
            byName: by.name,
          })
        : await host.run({
            op: "resolve",
            tenantId,
            incidentId: row.incidentId,
            message: doneOf(row),
            alone: false,
          });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
  if (op === "follow_up" && typeof row.payload?.followUpId === "string") {
    const r = await host.run({
      op: "cancel_follow_up",
      tenantId,
      followUpId: row.payload.followUpId,
      restore: phase === "do",
    });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
  return { ok: false, error: "nothing to undo" };
}

/**
 * Undo: the reverse call is made, the row is marked, the timeline gets its
 * own line, and — when Atlas had taken it alone and a person undoes it — the
 * service goes down one level.
 */
export async function undoAction(
  tenantId: string,
  actionId: string,
  by: Actor,
  host: AtlasHost,
): Promise<CommandResult> {
  const row = await withTenant(tenantId, (tx) => rowOf(tx, tenantId, actionId));
  if (!row) return refuse("not found");
  const can = undoable(row);
  if (!can.ok) return refuse(can.reason!);
  // Claimed first: a second tap finds it undone.
  const claimed = await withTenant(tenantId, (tx) =>
    tx
      .update(atlasActions)
      .set({ undoneAt: new Date(), undoneByMemberId: by.memberId })
      .where(and(eq(atlasActions.id, row.id), isNull(atlasActions.undoneAt)))
      .returning({ id: atlasActions.id }),
  );
  if (claimed.length === 0) return refuse("already undone");
  const r = await applyReverse(tenantId, row, "undo", host, by);
  if (!r.ok) {
    await withTenant(tenantId, (tx) =>
      tx
        .update(atlasActions)
        .set({ undoneAt: null, undoneByMemberId: null })
        .where(eq(atlasActions.id, row.id)),
    );
    return refuse(r.error ?? "the undo failed");
  }
  const level = await withTenant(tenantId, async (tx) => {
    await timelineUndoRedoTx(tx, tenantId, row, "atlas_undo", by);
    const svc = await serviceKeyOf(tx, row.serviceId);
    await auditAtlasTx(tx, tenantId, by, "atlas.undone", {
      action: doneOf(row),
      service: svc,
      autonomous: row.autonomous,
    });
    if (row.autonomous && by.memberId && row.serviceId) {
      const change = await dropTx(tx, tenantId, row.serviceId, "undo", by, {
        investigationId: row.investigationId,
      });
      return change ? { serviceKey: svc, ...change } : null;
    }
    return null;
  });
  return { ok: true, level };
}

/** Redo what was undone: the forward call again, its own timeline line. The ladder does not move. */
export async function redoAction(
  tenantId: string,
  actionId: string,
  by: Actor,
  host: AtlasHost,
): Promise<CommandResult> {
  const row = await withTenant(tenantId, (tx) => rowOf(tx, tenantId, actionId));
  if (!row) return refuse("not found");
  if (!row.undoneAt) return refuse("not undone");
  const r = await applyReverse(tenantId, row, "do", host, by);
  if (!r.ok) return refuse(r.error ?? "the redo failed");
  await withTenant(tenantId, async (tx) => {
    await tx
      .update(atlasActions)
      .set({ undoneAt: null, undoneByMemberId: null, redoneAt: new Date() })
      .where(eq(atlasActions.id, row.id));
    await timelineUndoRedoTx(tx, tenantId, row, "atlas_redo", by);
    await auditAtlasTx(tx, tenantId, by, "atlas.redone", {
      action: doneOf(row),
      service: await serviceKeyOf(tx, row.serviceId),
    });
  });
  return { ok: true };
}

/* ---------- Review and grades ---------- */

/**
 * The review queue's three verdicts on an autonomous resolution:
 *  ok     — "Looks right": graded On target, counts toward the level;
 *  miss   — "Not quite": graded Miss, and a Miss costs a level;
 *  reopen — undoes what can be undone (the resolution first), pages the
 *           service's owner, and takes the service down one level.
 */
export async function reviewResolution(
  tenantId: string,
  investigationId: string,
  verdict: "ok" | "miss" | "reopen",
  by: Actor,
  host: AtlasHost,
): Promise<CommandResult> {
  const inv = await withTenant(tenantId, async (tx) => {
    const [r] = await tx
      .select()
      .from(investigations)
      .where(and(eq(investigations.tenantId, tenantId), eq(investigations.id, investigationId)));
    return r ?? null;
  });
  if (!inv) return refuse("not found");
  if (inv.reviewState !== "pending") return refuse("already reviewed");
  if (verdict === "ok" || verdict === "miss") {
    const out = await withTenant(tenantId, async (tx) => {
      const claimed = await tx
        .update(investigations)
        .set({ reviewState: verdict })
        .where(and(eq(investigations.id, inv.id), eq(investigations.reviewState, "pending")))
        .returning({ id: investigations.id });
      if (claimed.length === 0) return null;
      const g = await gradeRunTx(tx, tenantId, inv.id, verdict === "ok" ? "on_target" : "miss", by);
      const facts = await incidentFactsTx(tx, tenantId, inv.incidentId);
      await auditAtlasTx(tx, tenantId, by, "atlas.reviewed", {
        incident: facts?.number ?? null,
        service: facts?.serviceKey ?? null,
        verdict,
      });
      return g.change ? { serviceKey: facts?.serviceKey ?? null, ...g.change } : null;
    });
    return { ok: true, level: out };
  }
  // Reopen.
  const claimed = await withTenant(tenantId, (tx) =>
    tx
      .update(investigations)
      .set({ reviewState: "reopened" })
      .where(and(eq(investigations.id, inv.id), eq(investigations.reviewState, "pending")))
      .returning({ id: investigations.id }),
  );
  if (claimed.length === 0) return refuse("already reviewed");
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(atlasActions)
      .where(
        and(
          eq(atlasActions.tenantId, tenantId),
          eq(atlasActions.incidentId, inv.incidentId),
          eq(atlasActions.reversible, true),
          isNull(atlasActions.undoneAt),
        ),
      ),
  );
  // The resolution first (the incident reopens), then the fixes, newest first.
  const order = rows
    .filter((r) => undoable(r, Date.now()).ok || r.payload?.op === "resolve")
    .sort((a, b) =>
      a.payload?.op === "resolve"
        ? -1
        : b.payload?.op === "resolve"
          ? 1
          : b.at.getTime() - a.at.getTime(),
    );
  const undone: string[] = [];
  const failed: string[] = [];
  for (const r of order) {
    const res = await applyReverse(tenantId, r, "undo", host, by);
    if (res.ok) {
      undone.push(r.id);
      await withTenant(tenantId, async (tx) => {
        await tx
          .update(atlasActions)
          .set({ undoneAt: new Date(), undoneByMemberId: by.memberId })
          .where(eq(atlasActions.id, r.id));
        await timelineUndoRedoTx(tx, tenantId, r, "atlas_undo", by);
      });
    } else failed.push(`${doneOf(r)}: ${res.error}`);
  }
  await host.run({
    op: "page",
    tenantId,
    incidentId: inv.incidentId,
    reason: "reopened",
    note: `Reopened by ${by.name}`,
  });
  const level = await withTenant(tenantId, async (tx) => {
    const facts = await incidentFactsTx(tx, tenantId, inv.incidentId);
    await auditAtlasTx(tx, tenantId, by, "atlas.reviewed", {
      incident: facts?.number ?? null,
      service: facts?.serviceKey ?? null,
      verdict: "reopen",
      undone: undone.length,
      failed,
    });
    if (!facts?.serviceId) return null;
    const change = await dropTx(tx, tenantId, facts.serviceId, "reopen", by, {
      investigationId: inv.id,
    });
    return change ? { serviceKey: facts.serviceKey, ...change } : null;
  });
  return failed.length ? { ok: true, level, error: failed.join(" · ") } : { ok: true, level };
}

/** A grade after closure (the Atlas tab's Bullseye / On target / Miss / Nowhere near). */
export async function gradeRunCommand(
  tenantId: string,
  investigationId: string,
  grade: InvestigationGrade,
  by: Actor,
  note?: string | null,
): Promise<CommandResult> {
  return withTenant(tenantId, async (tx) => {
    const g = await gradeRunTx(tx, tenantId, investigationId, grade, by, note);
    const key = await serviceKeyOf(tx, g.serviceId);
    await auditAtlasTx(tx, tenantId, by, "atlas.graded", { service: key, grade });
    return { ok: true, level: g.change ? { serviceKey: key, ...g.change } : null };
  });
}

/* ---------- Stop ---------- */

/** Stop on one incident: the run pauses and every proposal still waiting is withdrawn. */
export async function stopIncident(
  tenantId: string,
  incidentId: string,
  by: Actor,
): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    await tx
      .update(investigations)
      .set({ paused: true, updatedAt: new Date() })
      .where(and(eq(investigations.tenantId, tenantId), eq(investigations.incidentId, incidentId)));
    const withdrawn = await tx
      .update(atlasActions)
      .set({ approvalState: "withdrawn" })
      .where(
        and(
          eq(atlasActions.tenantId, tenantId),
          eq(atlasActions.incidentId, incidentId),
          eq(atlasActions.approvalState, "waiting"),
        ),
      )
      .returning({ id: atlasActions.id });
    const facts = await incidentFactsTx(tx, tenantId, incidentId);
    const [inv] = await tx
      .select({ id: investigations.id })
      .from(investigations)
      .where(eq(investigations.incidentId, incidentId));
    await recordStepTx(tx, {
      tenantId,
      incidentId,
      investigationId: inv?.id ?? null,
      serviceId: facts?.serviceId ?? null,
      kind: "human",
      title: `${by.name} stopped Atlas on this incident`,
      text: { key: "atlas.j.stopped", params: { member: by.name, n: withdrawn.length } },
      decidedByMemberId: by.memberId,
      actorName: by.name,
      level: null,
      payload: { withdrawn: withdrawn.length },
    });
    await auditAtlasTx(tx, tenantId, by, "atlas.stopped", {
      incident: facts?.number ?? null,
      withdrawn: withdrawn.length,
    });
    return withdrawn.length;
  });
}

/** Resume on one incident (the Atlas tab's Resume). */
export async function resumeIncident(
  tenantId: string,
  incidentId: string,
  by: Actor,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx
      .update(investigations)
      .set({ paused: false, updatedAt: new Date() })
      .where(and(eq(investigations.tenantId, tenantId), eq(investigations.incidentId, incidentId)));
    const facts = await incidentFactsTx(tx, tenantId, incidentId);
    await auditAtlasTx(tx, tenantId, by, "atlas.resumed", { incident: facts?.number ?? null });
  });
}

/** The kill switch: on, every proposal still waiting in the workspace is withdrawn. */
export async function setKillSwitch(tenantId: string, on: boolean, by: Actor): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const now = new Date();
    await tx
      .insert(atlasSettings)
      .values({ tenantId, killSwitch: on, killSwitchAt: now, killSwitchByMemberId: by.memberId })
      .onConflictDoUpdate({
        target: atlasSettings.tenantId,
        set: {
          killSwitch: on,
          killSwitchAt: now,
          killSwitchByMemberId: by.memberId,
          updatedAt: now,
        },
      });
    let withdrawn = 0;
    if (on) {
      const rows = await tx
        .update(atlasActions)
        .set({ approvalState: "withdrawn" })
        .where(and(eq(atlasActions.tenantId, tenantId), eq(atlasActions.approvalState, "waiting")))
        .returning({ id: atlasActions.id });
      withdrawn = rows.length;
    }
    await auditAtlasTx(tx, tenantId, by, on ? "atlas.kill_switch_on" : "atlas.kill_switch_off", {
      withdrawn,
    });
    return withdrawn;
  });
}

/* ---------- Settings › Atlas ---------- */

/** An admin's ceiling. It never raises the level; null removes it. */
export async function setServiceCap(
  tenantId: string,
  serviceId: string,
  cap: AutonomyLevel | null,
  by: Actor,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [cur] = await tx
      .select({ level: serviceAutonomy.level, cap: serviceAutonomy.cap })
      .from(serviceAutonomy)
      .where(and(eq(serviceAutonomy.tenantId, tenantId), eq(serviceAutonomy.serviceId, serviceId)));
    if ((cur?.cap ?? null) === cap) return;
    await tx
      .insert(serviceAutonomy)
      .values({ tenantId, serviceId, cap })
      .onConflictDoUpdate({
        target: serviceAutonomy.serviceId,
        set: { cap, updatedAt: new Date() },
      });
    await tx.insert(autonomyEvents).values({
      tenantId,
      serviceId,
      fromLevel: cur?.level ?? 0,
      toLevel: cur?.level ?? 0,
      cause: "cap",
      byMemberId: by.memberId,
      note: cap === null ? "cap removed" : `capped at level ${cap}`,
    });
    await auditAtlasTx(tx, tenantId, by, "atlas.capped", {
      service: await serviceKeyOf(tx, serviceId),
      cap,
    });
  });
}

export async function setNotifyMode(
  tenantId: string,
  memberId: string,
  mode: AtlasNotifyMode,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .insert(atlasNotifyPrefs)
      .values({ tenantId, memberId, mode })
      .onConflictDoUpdate({
        target: atlasNotifyPrefs.memberId,
        set: { mode, updatedAt: new Date() },
      }),
  );
}

/** On or off for one allowed action. An irreversible or unconfigured action can never be turned on. */
export async function setActionEnabled(
  tenantId: string,
  key: string,
  on: boolean,
  by: Actor,
): Promise<CommandResult> {
  return withTenant(tenantId, async (tx) => {
    const [a] = await tx
      .select()
      .from(actionCatalog)
      .where(and(eq(actionCatalog.tenantId, tenantId), eq(actionCatalog.key, key)));
    if (!a) return refuse("not found");
    if (on && !isReversible(a)) return refuse("irreversible");
    if (on && !isAvailable(a)) return refuse("unavailable");
    await tx
      .update(actionCatalog)
      .set({ enabled: on, updatedAt: new Date() })
      .where(eq(actionCatalog.id, a.id));
    await auditAtlasTx(tx, tenantId, by, on ? "atlas.action_enabled" : "atlas.action_disabled", {
      action: a.label,
      key,
    });
    return { ok: true };
  });
}

/** Where an action's requests go. Without an undo URL it is not reversible, and switched off. */
export async function configureAction(
  tenantId: string,
  key: string,
  http: { doUrl: string | null; undoUrl: string | null; verifyUrl: string | null },
  by: Actor,
): Promise<CommandResult> {
  const valid = (u: string | null) => u === null || /^https?:\/\/\S+$/i.test(u);
  if (!valid(http.doUrl) || !valid(http.undoUrl) || !valid(http.verifyUrl))
    return refuse("invalid URL");
  return withTenant(tenantId, async (tx) => {
    const [a] = await tx
      .select()
      .from(actionCatalog)
      .where(and(eq(actionCatalog.tenantId, tenantId), eq(actionCatalog.key, key)));
    if (!a) return refuse("not found");
    const limits = { ...(a.limits ?? {}), http };
    // An action declared irreversible stays so, whatever URL is typed in.
    const reversible = a.limits?.declared !== false && Boolean(http.undoUrl);
    await tx
      .update(actionCatalog)
      .set({
        limits,
        reversible,
        enabled: a.enabled && reversible && Boolean(http.doUrl),
        updatedAt: new Date(),
      })
      .where(eq(actionCatalog.id, a.id));
    await auditAtlasTx(tx, tenantId, by, "atlas.action_configured", {
      action: a.label,
      key,
      reversible,
    });
    return { ok: true };
  });
}

/** One guardrail on or off. "Nothing outside the allowed actions" is not a setting. */
export async function setGuardrail(
  tenantId: string,
  key: GuardrailKey,
  on: boolean,
  by: Actor,
): Promise<CommandResult> {
  if (key === "catalogOnly" || !GUARDRAILS.includes(key)) return refuse("locked");
  return withTenant(tenantId, async (tx) => {
    const [s] = await tx.select().from(atlasSettings).where(eq(atlasSettings.tenantId, tenantId));
    const g = { ...readGuardrails(s?.guardrails), [key]: on, catalogOnly: true as const };
    await tx
      .insert(atlasSettings)
      .values({ tenantId, guardrails: g })
      .onConflictDoUpdate({
        target: atlasSettings.tenantId,
        set: { guardrails: g, updatedAt: new Date() },
      });
    await auditAtlasTx(tx, tenantId, by, "atlas.guardrail_changed", { guardrail: key, on });
    return { ok: true };
  });
}

/** The monthly budget and the cap per run, in euros; null removes one. */
export async function setBudget(
  tenantId: string,
  budget: { monthEur: number | null; perRunEur: number | null },
  by: Actor,
): Promise<CommandResult> {
  const ok = (v: number | null) => v === null || (Number.isFinite(v) && v >= 0 && v < 1_000_000);
  if (!ok(budget.monthEur) || !ok(budget.perRunEur)) return refuse("invalid amount");
  await withTenant(tenantId, async (tx) => {
    await tx
      .insert(atlasSettings)
      .values({ tenantId, budgetMonthEur: budget.monthEur, capPerRunEur: budget.perRunEur })
      .onConflictDoUpdate({
        target: atlasSettings.tenantId,
        set: {
          budgetMonthEur: budget.monthEur,
          capPerRunEur: budget.perRunEur,
          updatedAt: new Date(),
        },
      });
    await auditAtlasTx(tx, tenantId, by, "atlas.budget_changed", {
      month: budget.monthEur,
      perRun: budget.perRunEur,
    });
  });
  return { ok: true };
}

/**
 * A new automation secret: the salt changes, so every request signed from
 * now on uses the new secret. Returned once, to be shown once.
 */
export async function rotateExecutorSecret(tenantId: string, by: Actor): Promise<string> {
  const nonce = newExecutorNonce();
  await withTenant(tenantId, async (tx) => {
    await tx
      .insert(atlasSettings)
      .values({ tenantId, executorNonce: nonce })
      .onConflictDoUpdate({
        target: atlasSettings.tenantId,
        set: { executorNonce: nonce, updatedAt: new Date() },
      });
    await auditAtlasTx(tx, tenantId, by, "atlas.secret_rotated", {});
  });
  return executorSecret(tenantId, nonce);
}

/** The proposals waiting on a set of incidents — for the chat's `atlas approve`. */
export async function waitingProposals(tenantId: string, incidentIds: string[]) {
  if (incidentIds.length === 0) return [];
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(atlasActions)
      .where(
        and(
          eq(atlasActions.tenantId, tenantId),
          inArray(atlasActions.incidentId, incidentIds),
          eq(atlasActions.approvalState, "waiting"),
          isNotNull(atlasActions.approvalRequestedAt),
        ),
      ),
  );
}
