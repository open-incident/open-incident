"use server";

/**
 * The buttons of every Atlas surface — owner: atlas-ui. Each checks the member
 * first (the commands never trust their caller), calls the command of
 * `@/lib/atlas/control`, and says in one line what happened, for the toast.
 * A command the engine refuses comes back as a sentence, never as a crash.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { atlasActions, investigations, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import {
  approveAction,
  redoAction,
  rejectAction,
  resumeIncident,
  reviewResolution,
  setNotifyMode,
  AtlasRefusal,
  stopIncident,
  undoAction,
  type AtlasActor,
} from "@/lib/atlas/control";
import { isUndone } from "./run";

export type AtlasResult = { ok: boolean; message: string };

const uuid = z.string().uuid();

async function responder() {
  const current = await requireMember();
  if (!canRespond(current.member)) return null;
  const actor: AtlasActor = { memberId: current.member.id, label: current.member.name };
  return { current, actor };
}

function refresh() {
  // Every Atlas surface hangs off /app: the incident, the queue, home, alerts.
  revalidatePath("/app", "layout");
}

async function refused(err: unknown): Promise<AtlasResult> {
  const t = await getT();
  // A refusal says why, in the engine's words; anything else is a failure.
  if (err instanceof AtlasRefusal)
    return { ok: false, message: `${t("atlas.ui.refused")} (${err.message})` };
  console.error("[atlas-ui] command failed:", err);
  return { ok: false, message: t("atlas.ui.refused") };
}

/**
 * A command that answers `{ ok: false, error }` instead of throwing (the
 * engine's way) is a refusal too: the toast says so, with the engine's reason.
 */
async function refusedResult(res: unknown): Promise<AtlasResult | null> {
  if (!res || typeof res !== "object" || !("ok" in res) || (res as { ok: unknown }).ok !== false)
    return null;
  const t = await getT();
  const error = (res as { error?: unknown }).error;
  return {
    ok: false,
    message:
      typeof error === "string" && error
        ? `${t("atlas.ui.refused")} (${error})`
        : t("atlas.ui.refused"),
  };
}

async function forbidden(): Promise<AtlasResult> {
  const t = await getT();
  return { ok: false, message: t("atlas.ui.forbidden") };
}

/** Pause: Atlas keeps reading but takes no action. Resume: it may again. */
export async function atlasPause(incidentId: string, paused: boolean): Promise<AtlasResult> {
  const who = await responder();
  if (!who) return forbidden();
  const t = await getT();
  const id = uuid.parse(incidentId);
  try {
    if (paused)
      await withTenant(who.current.tenant.id, (tx) =>
        tx
          .update(investigations)
          .set({ paused: true, updatedAt: new Date() })
          .where(
            and(
              eq(investigations.tenantId, who.current.tenant.id),
              eq(investigations.incidentId, id),
            ),
          ),
      );
    else await resumeIncident(who.current.tenant.id, id, who.actor);
  } catch (err) {
    return refused(err);
  }
  refresh();
  return { ok: true, message: paused ? t("atlas.ui.toast.paused") : t("atlas.ui.toast.resumed") };
}

/** Stop on this incident: no further action, pending proposals withdrawn. */
export async function atlasStop(incidentId: string): Promise<AtlasResult> {
  const who = await responder();
  if (!who) return forbidden();
  const t = await getT();
  try {
    const withdrawn = await stopIncident(who.current.tenant.id, uuid.parse(incidentId), who.actor);
    refresh();
    return { ok: true, message: t("atlas.ui.toast.stopped", { count: withdrawn }) };
  } catch (err) {
    return refused(err);
  }
}

/** Undo or redo, whichever the action's state calls for. */
export async function atlasToggleUndo(actionId: string): Promise<AtlasResult> {
  const who = await responder();
  if (!who) return forbidden();
  const t = await getT();
  const id = uuid.parse(actionId);
  const tenantId = who.current.tenant.id;
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(atlasActions)
      .where(and(eq(atlasActions.tenantId, tenantId), eq(atlasActions.id, id))),
  );
  if (!row) return { ok: false, message: t("atlas.ui.gone") };
  const undone = isUndone(row);
  try {
    const res: unknown = undone
      ? await redoAction(tenantId, id, who.actor)
      : await undoAction(tenantId, id, who.actor);
    const no = await refusedResult(res);
    if (no) return no;
  } catch (err) {
    return refused(err);
  }
  refresh();
  return {
    ok: true,
    message: undone ? t("atlas.ui.toast.redone") : t("atlas.ui.toast.undone"),
  };
}

/** One tap on a waiting proposal. */
export async function atlasDecide(actionId: string, approve: boolean): Promise<AtlasResult> {
  const who = await responder();
  if (!who) return forbidden();
  const t = await getT();
  try {
    const res: unknown = approve
      ? await approveAction(who.current.tenant.id, uuid.parse(actionId), who.actor)
      : await rejectAction(who.current.tenant.id, uuid.parse(actionId), who.actor);
    const no = await refusedResult(res);
    if (no) return no;
  } catch (err) {
    return refused(err);
  }
  refresh();
  return {
    ok: true,
    message: approve ? t("atlas.ui.toast.approved") : t("atlas.ui.toast.rejected"),
  };
}

/** The review queue's verdicts. */
export async function atlasReview(
  investigationId: string,
  verdict: "ok" | "miss" | "reopen",
  number: number,
): Promise<AtlasResult> {
  const who = await responder();
  if (!who) return forbidden();
  const t = await getT();
  const v = z.enum(["ok", "miss", "reopen"]).parse(verdict);
  try {
    const res: unknown = await reviewResolution(
      who.current.tenant.id,
      uuid.parse(investigationId),
      v,
      who.actor,
    );
    const no = await refusedResult(res);
    if (no) return no;
  } catch (err) {
    return refused(err);
  }
  refresh();
  return { ok: true, message: t(`atlas.ui.review.toast.${v}`, { number }) };
}

/** "When Atlas resolves on its own" — each member for themselves. */
export async function atlasNotifyMode(mode: string): Promise<AtlasResult> {
  const current = await requireMember();
  const t = await getT();
  const m = z.enum(["push", "summary", "nothing"]).parse(mode);
  await setNotifyMode(current.tenant.id, current.member.id, m);
  revalidatePath("/app/on-call");
  return { ok: true, message: t("atlas.ui.notify.saved") };
}
