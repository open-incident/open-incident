/**
 * Commands on Atlas — CONTRACT shared by the engine, the screens and the chat.
 *
 * Owner: atlas-core. Callers: atlas-ui's buttons (through server actions of
 * their own that check the member and revalidate), the chat commands
 * (`atlas stop`, `atlas stop all`, `atlas approve`), the mobile signed links.
 *
 * Each function takes the acting member (or "chat:<user>" / "link" for the
 * signed paths), writes what it did to the audit log under `atlas.*`, and
 * never trusts its caller for permission — the caller checks first.
 *
 * The simple ones are implemented here. The ones that need the executors are
 * atlas-core's to write; until then they refuse loudly rather than pretend.
 */
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import {
  atlasActions,
  atlasNotifyPrefs,
  atlasSettings,
  investigations,
  serviceAutonomy,
  withTenant,
  type AtlasNotifyMode,
  type AutonomyLevel,
} from "@openincident/db";

export type AtlasActor = { memberId: string | null; label: string };

/** Kill switch — every service, at once. In-flight runs stop proposing and acting. */
export async function setKillSwitch(tenantId: string, on: boolean, by: AtlasActor): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx
      .insert(atlasSettings)
      .values({
        tenantId,
        killSwitch: on,
        killSwitchAt: new Date(),
        killSwitchByMemberId: by.memberId,
      })
      .onConflictDoUpdate({
        target: atlasSettings.tenantId,
        set: {
          killSwitch: on,
          killSwitchAt: new Date(),
          killSwitchByMemberId: by.memberId,
          updatedAt: new Date(),
        },
      });
  });
}

/** Stop on one incident: the run pauses and every proposal still waiting is withdrawn. */
export async function stopIncident(
  tenantId: string,
  incidentId: string,
  by: AtlasActor,
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
          inArray(atlasActions.approvalState, ["waiting"]),
        ),
      )
      .returning({ id: atlasActions.id });
    void by;
    return withdrawn.length;
  });
}

/** An admin's ceiling on a service. Null removes it. Never raises the level itself. */
export async function setServiceCap(
  tenantId: string,
  serviceId: string,
  cap: AutonomyLevel | null,
  by: AtlasActor,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx
      .insert(serviceAutonomy)
      .values({ tenantId, serviceId, cap })
      .onConflictDoUpdate({
        target: serviceAutonomy.serviceId,
        set: { cap, updatedAt: new Date() },
      });
  });
  void by;
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

/* ---- atlas-core implements the four below against the executors ---- */

/** Approve a waiting proposal: it runs, is verified, and the journal says who approved. */
export async function approveAction(
  tenantId: string,
  actionId: string,
  by: AtlasActor,
): Promise<void> {
  void tenantId;
  void actionId;
  void by;
  throw new Error("approveAction: not implemented yet (atlas-core)");
}

/** Reject a waiting proposal. */
export async function rejectAction(
  tenantId: string,
  actionId: string,
  by: AtlasActor,
): Promise<void> {
  void tenantId;
  void actionId;
  void by;
  throw new Error("rejectAction: not implemented yet (atlas-core)");
}

/** Undo a reversible action (24 h window for an autonomous resolution). Writes its own timeline event; costs the service a level if Atlas took it alone. */
export async function undoAction(
  tenantId: string,
  actionId: string,
  by: AtlasActor,
): Promise<void> {
  void tenantId;
  void actionId;
  void by;
  throw new Error("undoAction: not implemented yet (atlas-core)");
}

/** Redo what was undone. */
export async function redoAction(
  tenantId: string,
  actionId: string,
  by: AtlasActor,
): Promise<void> {
  void tenantId;
  void actionId;
  void by;
  throw new Error("redoAction: not implemented yet (atlas-core)");
}

/** Review queue verdicts: Looks right (on_target), Not quite (miss), Reopen (undo what can be, page the owner, service one level down). */
export async function reviewResolution(
  tenantId: string,
  investigationId: string,
  verdict: "ok" | "miss" | "reopen",
  by: AtlasActor,
): Promise<void> {
  void tenantId;
  void investigationId;
  void verdict;
  void by;
  throw new Error("reviewResolution: not implemented yet (atlas-core)");
}
