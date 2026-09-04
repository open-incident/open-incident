/**
 * The trackers as the workspace configured them, and the two operations the
 * product performs with them: export a follow-up, bring its status back.
 * Shared by the web app (export, manual sync) and the worker (periodic sync).
 */
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { decryptSecret } from "@openincident/crypto";
import {
  followUpPriorities,
  followUps,
  incidentEvents,
  incidents,
  integrationInstalls,
  withTenant,
  type Tx,
} from "@openincident/db";
import {
  createIssue,
  issueBody,
  readIssueState,
  TRACKER_KINDS,
  type IssueRef,
  type TrackerConfig,
  type TrackerKind,
} from "./index";

export type TrackerInstall = {
  id: string;
  kind: TrackerKind;
  config: TrackerConfig;
  secret: string;
  label: string;
};

function isTrackerKind(kind: string): kind is TrackerKind {
  return (TRACKER_KINDS as string[]).includes(kind);
}

/** What a workspace can export to, secrets decrypted for use — never returned to a page as-is. */
export async function listTrackerInstalls(tx: Tx, tenantId: string): Promise<TrackerInstall[]> {
  const rows = await tx
    .select()
    .from(integrationInstalls)
    .where(
      and(eq(integrationInstalls.tenantId, tenantId), eq(integrationInstalls.status, "active")),
    )
    .orderBy(asc(integrationInstalls.createdAt));
  const out: TrackerInstall[] = [];
  for (const r of rows) {
    if (!isTrackerKind(r.kind)) continue;
    const secret = decryptSecret(r.encryptedSecrets);
    if (!secret) continue;
    const config = { ...(r.config as Omit<TrackerConfig, "kind">), kind: r.kind } as TrackerConfig;
    out.push({
      id: r.id,
      kind: r.kind,
      config,
      secret,
      label: r.externalName ?? trackerLabel(r.kind),
    });
  }
  return out;
}

export function trackerLabel(kind: TrackerKind): string {
  return kind === "github"
    ? "GitHub Issues"
    : kind === "gitlab"
      ? "GitLab Issues"
      : kind === "jira"
        ? "Jira"
        : "Linear";
}

/** The target a config names — repo, project, team — for the settings card. */
export function trackerTarget(config: TrackerConfig): string {
  return config.kind === "github"
    ? config.repo
    : config.kind === "gitlab"
      ? config.project
      : config.kind === "jira"
        ? `${config.site} · ${config.projectKey}`
        : config.teamKey;
}

/**
 * Exports one follow-up: creates the issue, stores the reference, writes the
 * timeline. Refuses a follow-up that already has one.
 */
export async function exportFollowUp(
  tenantId: string,
  followUpId: string,
  kind: TrackerKind,
  actor: { memberId: string | null; name: string },
  origin: string,
): Promise<
  | { ok: true; ref: IssueRef }
  | {
      ok: false;
      reason: "not_found" | "already_exported" | "not_connected" | "failed";
      detail?: string;
    }
> {
  type Prepared =
    | { error: "not_found" | "already_exported" | "not_connected" }
    | {
        row: {
          fu: typeof followUps.$inferSelect;
          incNumber: number;
          incName: string;
          priority: string | null;
        };
        install: TrackerInstall;
      };
  const prepared = await withTenant(tenantId, async (tx): Promise<Prepared> => {
    const [row] = await tx
      .select({
        fu: followUps,
        incNumber: incidents.number,
        incName: incidents.name,
        priority: followUpPriorities.name,
      })
      .from(followUps)
      .innerJoin(incidents, eq(incidents.id, followUps.incidentId))
      .leftJoin(followUpPriorities, eq(followUpPriorities.id, followUps.priorityId))
      .where(and(eq(followUps.tenantId, tenantId), eq(followUps.id, followUpId)));
    if (!row) return { error: "not_found" };
    if (row.fu.externalRef) return { error: "already_exported" };
    const install = (await listTrackerInstalls(tx, tenantId)).find((i) => i.kind === kind);
    if (!install) return { error: "not_connected" };
    return { row, install };
  });
  if ("error" in prepared) return { ok: false, reason: prepared.error };
  const { row, install } = prepared;
  const priority =
    row.priority === "P1" || row.priority === "P2" || row.priority === "P3"
      ? row.priority
      : undefined;
  let ref: IssueRef;
  try {
    ref = await createIssue(install.config, install.secret, {
      title: row.fu.title,
      body: issueBody({
        incidentNumber: row.incNumber,
        incidentName: row.incName,
        incidentUrl: `${origin}/app/incidents/${row.incNumber}`,
        priority: row.priority,
        dueAt: row.fu.dueAt,
      }),
      priority,
    });
  } catch (err) {
    return {
      ok: false,
      reason: "failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  await withTenant(tenantId, async (tx) => {
    await tx
      .update(followUps)
      .set({
        externalRef: { tracker: kind, key: ref.key, url: ref.url, id: ref.id },
        updatedAt: new Date(),
      })
      .where(eq(followUps.id, row.fu.id));
    await tx.insert(incidentEvents).values({
      tenantId,
      incidentId: row.fu.incidentId,
      kind: "link_added",
      actorKind: actor.memberId ? "member" : "system",
      actorMemberId: actor.memberId,
      actorName: actor.name,
      payload: {
        provider: kind,
        kind: "issue",
        ref: ref.key,
        title: row.fu.title,
        url: ref.url,
      },
    });
  });
  return { ok: true, ref };
}

/**
 * Brings issue states back: an exported follow-up still open here whose issue
 * is closed there becomes done, with a timeline line saying where from.
 * Returns how many changed; a tracker that fails is skipped, not fatal.
 */
export async function syncTrackerStatuses(
  tenantId: string,
): Promise<{ checked: number; completed: number; errors: number }> {
  const installs = await withTenant(tenantId, (tx) => listTrackerInstalls(tx, tenantId));
  if (installs.length === 0) return { checked: 0, completed: 0, errors: 0 };
  const open = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: followUps.id,
        incidentId: followUps.incidentId,
        title: followUps.title,
        externalRef: followUps.externalRef,
      })
      .from(followUps)
      .where(
        and(
          eq(followUps.tenantId, tenantId),
          eq(followUps.status, "open"),
          isNotNull(followUps.externalRef),
        ),
      ),
  );
  let checked = 0;
  let completed = 0;
  let errors = 0;
  for (const fu of open) {
    const ref = fu.externalRef;
    if (!ref || !isTrackerKind(ref.tracker)) continue;
    const install = installs.find((i) => i.kind === ref.tracker);
    if (!install) continue;
    checked++;
    try {
      const state = await readIssueState(install.config, install.secret, {
        id: ref.id ?? ref.key,
        key: ref.key,
        url: ref.url ?? "",
      });
      if (state !== "closed") continue;
      await withTenant(tenantId, async (tx) => {
        const now = new Date();
        const changed = await tx
          .update(followUps)
          .set({ status: "done", completedAt: now, updatedAt: now })
          .where(and(eq(followUps.id, fu.id), eq(followUps.status, "open")))
          .returning({ id: followUps.id });
        if (changed.length === 0) return;
        await tx.insert(incidentEvents).values({
          tenantId,
          incidentId: fu.incidentId,
          kind: "follow_up_completed",
          actorKind: "system",
          actorName: trackerLabel(install.kind),
          payload: { title: fu.title, via: install.kind, ref: ref.key, url: ref.url },
        });
      });
      completed++;
    } catch (err) {
      errors++;
      console.error(
        `[trackers] ${install.kind} state read failed for ${ref.key}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { checked, completed, errors };
}
