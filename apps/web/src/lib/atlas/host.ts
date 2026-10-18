/**
 * The web app as the Atlas engine's host: the product's own write paths for
 * what Atlas does inside an incident (resolve, reopen, a follow-up), paging a
 * person, and Atlas's notifications. Called directly by the commands that run
 * in this process (control.ts), and by the worker through the signed route
 * /api/atlas/internal. Owner: atlas-core.
 */
import "server-only";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import {
  alerts,
  atlasActions,
  atlasNotifyPrefs,
  escalations,
  followUps,
  incidentEvents,
  incidentStatuses,
  incidents,
  investigations,
  members,
  notificationDeliveries,
  services,
  withTenant,
  workspaces,
} from "@openincident/db";
import {
  advanceEscalation,
  cancelEscalation,
  resolvePathFromService,
  sendAtlasNotice,
  startEscalation,
} from "@openincident/oncall";
import { linkedPublicIncident, publishIncidentUpdate } from "@openincident/statuspages";
import { atlas } from "@openincident/investigations";
import { addFollowUpCore, afterIncidentChange, postUpdateCore } from "@/lib/incident-writes";
import { buildTranslate } from "@/i18n/server";
import { resolveLocale } from "@/i18n/locales";

type HostOp = atlas.HostOp;
type HostResult = atlas.HostResult;

const ATLAS = { kind: "system" as const, memberId: null, name: "Atlas" };

export const webHost: atlas.AtlasHost = { run: (op) => runHostOp(op) };

export async function runHostOp(op: HostOp): Promise<HostResult> {
  try {
    switch (op.op) {
      case "resolve":
        return await resolveOp(op.tenantId, op.incidentId, op.message);
      case "reopen":
        return await reopenOp(op.tenantId, op.incidentId, op.message, op.byName);
      case "follow_up": {
        const r = await withTenant(op.tenantId, (tx) =>
          addFollowUpCore(tx, op.tenantId, ATLAS, op.incidentId, { title: op.title }),
        );
        return r
          ? { ok: true, data: { followUpId: r.id } }
          : { ok: false, error: "incident not found" };
      }
      case "cancel_follow_up": {
        const rows = await withTenant(op.tenantId, (tx) =>
          tx
            .update(followUps)
            .set({ status: op.restore ? "open" : "cancelled", updatedAt: new Date() })
            .where(and(eq(followUps.tenantId, op.tenantId), eq(followUps.id, op.followUpId)))
            .returning({ id: followUps.id }),
        );
        return rows.length ? { ok: true } : { ok: false, error: "follow-up not found" };
      }
      case "page":
        return await pageOp(op.tenantId, op.incidentId);
      case "notify":
        return await notifyOp(op.tenantId, op.kind, op.incidentId, op.actionId);
      case "summary":
        return await summaryOp(op.tenantId, op.memberId);
    }
  } catch (err) {
    console.error(`[atlas host] ${op.op} failed:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ---------- Resolve and reopen ---------- */

async function workspaceLocale(tenantId: string): Promise<string> {
  const [ws] = await withTenant(tenantId, (tx) =>
    tx
      .select({ locale: workspaces.locale })
      .from(workspaces)
      .where(eq(workspaces.tenantId, tenantId)),
  );
  return ws?.locale ?? "en";
}

/** The incident's escalations still paging — its own, and its alerts'. */
async function pendingEscalations(tenantId: string, incidentId: string) {
  return withTenant(tenantId, async (tx) => {
    const ids = (
      await tx
        .select({ id: alerts.id })
        .from(alerts)
        .where(and(eq(alerts.tenantId, tenantId), eq(alerts.incidentId, incidentId)))
    ).map((a) => a.id);
    return tx
      .select()
      .from(escalations)
      .where(
        and(
          eq(escalations.tenantId, tenantId),
          eq(escalations.status, "pending"),
          ids.length
            ? or(eq(escalations.incidentId, incidentId), inArray(escalations.alertId, ids))
            : eq(escalations.incidentId, incidentId),
        ),
      );
  });
}

async function resolveOp(tenantId: string, incidentId: string, message: string) {
  const locale = await workspaceLocale(tenantId);
  const result = await withTenant(tenantId, (tx) =>
    postUpdateCore(tx, tenantId, ATLAS, incidentId, {
      statusId: "resolve",
      message,
      resolvedLabel: buildTranslate(resolveLocale(locale))("incident.update.resolved"),
    }),
  );
  if (!result) return { ok: false, error: "the incident cannot be resolved" };
  await afterIncidentChange(
    tenantId,
    incidentId,
    ["incident.update_published", "incident.resolved"],
    { message, by: "Atlas" },
    { actorMemberId: null },
  );
  // Nobody needs to be woken for a solved problem.
  for (const e of await pendingEscalations(tenantId, incidentId))
    await cancelEscalation(tenantId, e.id, "atlas_resolved").catch(() => {});
  // The public status page: only when the guardrail lets Atlas publish, and only
  // on a page a person already published this incident to.
  const settings = await atlas.readSettings(tenantId);
  if (!settings.guardrails.publicStatusPage) {
    const linked = await withTenant(tenantId, (tx) =>
      linkedPublicIncident(tx, tenantId, incidentId),
    );
    if (linked)
      await publishIncidentUpdate(tenantId, incidentId, {
        pageId: linked.pageId,
        body: message,
        actor: { memberId: null, name: "Atlas" },
      }).catch((err) => console.error("[atlas host] status page publish failed:", err));
  }
  return { ok: true };
}

async function reopenOp(tenantId: string, incidentId: string, message: string, byName: string) {
  const done = await withTenant(tenantId, async (tx) => {
    const [inc] = await tx
      .select()
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)));
    if (!inc) return false;
    if (inc.phase === "triage" || inc.phase === "active") return true;
    const [first] = await tx
      .select({ id: incidentStatuses.id })
      .from(incidentStatuses)
      .where(eq(incidentStatuses.typeId, inc.typeId))
      .orderBy(asc(incidentStatuses.rank))
      .limit(1);
    const now = new Date();
    await tx
      .update(incidents)
      .set({
        phase: "active",
        statusId: first?.id ?? null,
        resolvedAt: null,
        closedAt: null,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(incidents.id, incidentId));
    await tx.insert(incidentEvents).values({
      tenantId,
      incidentId,
      kind: "reopened",
      actorKind: "system",
      actorName: byName,
      payload: { reason: message, by: byName, via: "atlas" },
      occurredAt: now,
    });
    // Reopened through Atlas's own undo: the sweep must not count it twice.
    await tx
      .update(investigations)
      .set({ reviewState: "reopened", updatedAt: now })
      .where(
        and(
          eq(investigations.incidentId, incidentId),
          inArray(investigations.reviewState, ["pending", "ok"]),
        ),
      );
    return true;
  });
  if (!done) return { ok: false, error: "incident not found" };
  await afterIncidentChange(tenantId, incidentId, ["incident.updated"], { by: byName });
  return { ok: true };
}

/* ---------- Paging ---------- */

/** Who the page reached: the latest delivery of the incident's escalations. */
async function pagedName(tenantId: string, escalationIds: string[]): Promise<string | null> {
  if (escalationIds.length === 0) return null;
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({ name: members.name })
      .from(notificationDeliveries)
      .innerJoin(members, eq(members.id, notificationDeliveries.memberId))
      .where(
        and(
          eq(notificationDeliveries.tenantId, tenantId),
          inArray(notificationDeliveries.escalationId, escalationIds),
        ),
      )
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(1),
  );
  return row?.name ?? null;
}

/**
 * A person, now. An escalation held while Atlas tried (level 4) is released;
 * one already paging keeps paging; with none at all, the owner's policy starts.
 */
async function pageOp(tenantId: string, incidentId: string): Promise<HostResult> {
  const pending = await pendingEscalations(tenantId, incidentId);
  const now = new Date();
  if (pending.length > 0) {
    for (const e of pending) {
      if (e.nextTickAt && e.nextTickAt.getTime() > now.getTime() + 1000)
        await withTenant(tenantId, (tx) =>
          tx.update(escalations).set({ nextTickAt: now }).where(eq(escalations.id, e.id)),
        );
      await advanceEscalation(tenantId, e.id).catch((err) =>
        console.error("[atlas host] escalation advance failed:", err),
      );
    }
    return {
      ok: true,
      data: {
        paged: await pagedName(
          tenantId,
          pending.map((e) => e.id),
        ),
      },
    };
  }
  // Already acknowledged by someone: that person is on it.
  const [acked] = await withTenant(tenantId, (tx) =>
    tx
      .select({ name: members.name })
      .from(escalations)
      .innerJoin(members, eq(members.id, escalations.ackedByMemberId))
      .where(
        and(
          eq(escalations.tenantId, tenantId),
          eq(escalations.incidentId, incidentId),
          eq(escalations.status, "acked"),
        ),
      )
      .limit(1),
  );
  if (acked) return { ok: true, data: { paged: acked.name } };
  const path = await withTenant(tenantId, async (tx) => {
    const [inc] = await tx
      .select({ serviceId: incidents.serviceId })
      .from(incidents)
      .where(eq(incidents.id, incidentId));
    return inc?.serviceId ? resolvePathFromService(tx, tenantId, inc.serviceId) : null;
  });
  if (!path) return { ok: false, error: "the service has no owner with an escalation policy" };
  const started = await startEscalation(tenantId, {
    pathId: path.pathId,
    incidentId,
    urgency: "high",
    triggeredBy: { kind: "system", name: "Atlas" },
  });
  if (!started) return { ok: false, error: "the owner's policy is not published" };
  await advanceEscalation(tenantId, started.id).catch(() => {});
  return { ok: true, data: { paged: await pagedName(tenantId, [started.id]) } };
}

/* ---------- Notifications ---------- */

async function memberRows(tenantId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const [rows, locale] = await Promise.all([
    withTenant(tenantId, (tx) =>
      tx
        .select({ id: members.id, email: members.email, locale: members.locale })
        .from(members)
        .where(and(eq(members.tenantId, tenantId), inArray(members.id, ids))),
    ),
    workspaceLocale(tenantId),
  ]);
  return rows.map((m) => ({ ...m, t: buildTranslate(resolveLocale(m.locale ?? locale)) }));
}

async function incidentLine(tenantId: string, incidentId: string) {
  const [r] = await withTenant(tenantId, (tx) =>
    tx
      .select({
        number: incidents.number,
        name: incidents.name,
        service: services.key,
        serviceId: incidents.serviceId,
      })
      .from(incidents)
      .leftJoin(services, eq(services.id, incidents.serviceId))
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId))),
  );
  return r ?? null;
}

async function notifyOp(
  tenantId: string,
  kind: "resolved" | "proposal",
  incidentId: string,
  actionId: string | null,
): Promise<HostResult> {
  const inc = await incidentLine(tenantId, incidentId);
  if (!inc) return { ok: false, error: "incident not found" };
  const origin = await atlas.tenantPublicOrigin(tenantId);
  const concerned = await withTenant(tenantId, (tx) =>
    atlas.concernedMembersTx(tx, tenantId, inc.serviceId ? [inc.serviceId] : []),
  );
  const modes = await withTenant(tenantId, (tx) => atlas.modesTx(tx, tenantId, concerned));
  // A resolution reaches those who chose the push right away; a proposal, everyone concerned.
  const who = kind === "resolved" ? concerned.filter((m) => modes.get(m) === "push") : concerned;
  const [row] = actionId
    ? await withTenant(tenantId, (tx) =>
        tx.select().from(atlasActions).where(eq(atlasActions.id, actionId)),
      )
    : [];
  const what = String(row?.payload?.todo ?? row?.payload?.done ?? row?.title ?? inc.name);
  const reference = `INC-${inc.number}`;
  const sent: string[] = [];
  for (const m of await memberRows(tenantId, who)) {
    const link = (op: "undo" | "approve") =>
      actionId
        ? `${origin}/ack/atlas/${atlas.signLink({ t: tenantId, op, id: actionId, m: m.id }, atlas.UNDO_WINDOW_MS)}`
        : `${origin}/app/incidents/${inc.number}?tab=atlas`;
    const notice =
      kind === "resolved"
        ? {
            title: m.t("atlas.n.resolvedTitle", { incident: reference }),
            body: m.t("atlas.n.resolvedBody", { service: inc.service ?? "—", what }),
            url: `${origin}/app/incidents?tab=atlas`,
            actions: [
              { action: "undo", title: m.t("atlas.n.undo"), url: link("undo") },
              {
                action: "review",
                title: m.t("atlas.n.review"),
                url: `${origin}/app/incidents?tab=atlas`,
              },
            ],
            silent: true,
          }
        : {
            title: m.t("atlas.n.proposalTitle"),
            body: m.t("atlas.n.proposalBody", {
              incident: reference,
              service: inc.service ?? "—",
              what,
            }),
            url: `${origin}/app/incidents/${inc.number}?tab=atlas`,
            actions: [
              { action: "approve", title: m.t("atlas.n.approve"), url: link("approve") },
              {
                action: "open",
                title: m.t("atlas.n.open"),
                url: `${origin}/app/incidents/${inc.number}?tab=atlas`,
              },
            ],
            silent: false,
          };
    const r = await sendAtlasNotice(tenantId, m, {
      ...notice,
      inbox: {
        title: notice.title,
        body: notice.body,
        url:
          kind === "resolved"
            ? "/app/incidents?tab=atlas"
            : `/app/incidents/${inc.number}?tab=atlas`,
        incidentId,
        groupKey: `atlas:${kind}:${incidentId}`,
      },
    });
    sent.push(`${m.id}:${r.via}`);
  }
  return { ok: true, data: { sent } };
}

async function summaryOp(tenantId: string, memberId: string): Promise<HostResult> {
  const [m] = await memberRows(tenantId, [memberId]);
  if (!m) return { ok: false, error: "member not found" };
  const lines = await withTenant(tenantId, async (tx) => {
    const [pref] = await tx
      .select({ last: atlasNotifyPrefs.lastSummaryAt })
      .from(atlasNotifyPrefs)
      .where(eq(atlasNotifyPrefs.memberId, memberId));
    const since = pref?.last ?? new Date(Date.now() - 24 * 3_600_000);
    const all = await atlas.resolutionsSinceTx(tx, tenantId, since);
    const mine = await atlas.concernedMembersTx(
      tx,
      tenantId,
      all.map((l) => l.serviceId).filter((x): x is string => Boolean(x)),
    );
    return mine.includes(memberId) ? all : [];
  });
  if (lines.length === 0) return { ok: false, error: "nothing to summarise" };
  const origin = await atlas.tenantPublicOrigin(tenantId);
  const review = `${origin}/app/incidents?tab=atlas`;
  const text = lines.map((l) =>
    m.t("atlas.n.summaryLine", {
      incident: `INC-${l.number}`,
      service: l.service ?? "—",
      time: m.t.fmt.time(l.resolvedAt),
      how: l.alone ? m.t("atlas.n.summaryAlone") : m.t("atlas.n.summaryTold"),
    }),
  );
  const title = m.t("atlas.n.summaryTitle", { count: lines.length });
  const r = await sendAtlasNotice(tenantId, m, {
    title,
    body: text.slice(0, 4).join("\n"),
    url: review,
    actions: [{ action: "review", title: m.t("atlas.n.review"), url: review }],
    silent: true,
    inbox: {
      title,
      body: text.join("\n"),
      url: "/app/incidents?tab=atlas",
      incidentId: null,
      groupKey: `atlas:summary:${new Date().toISOString().slice(0, 10)}`,
    },
    emailFallback: {
      subject: title,
      text: [...text, "", m.t("atlas.n.summaryEmailFoot", { url: review })].join("\n"),
    },
  });
  return r.via === "none" ? { ok: false, error: r.error } : { ok: true, data: { via: r.via } };
}

/** Members the journal or a link names — kept here so the link pages need nothing else. */
export async function memberName(tenantId: string, id: string | null): Promise<string | null> {
  if (!id) return null;
  const [r] = await withTenant(tenantId, (tx) =>
    tx
      .select({ name: members.name })
      .from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.id, id))),
  );
  return r?.name ?? null;
}
