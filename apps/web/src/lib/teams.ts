/**
 * The Teams surface, server side: which workspace an activity belongs to,
 * and what each message or card submission does. Every gesture ends in the
 * same write path as the web — declareIncidentCore, postUpdateCore,
 * startEscalation, role assignment — the adapter translates, it does not decide.
 */
import { canRespond } from "@openincident/config";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import {
  atlasActions,
  escalationPaths,
  getTenantById,
  getTenantIdForApiKeyHash,
  incidentEvents,
  incidentRoles,
  incidentStatuses,
  incidentTypes,
  incidents,
  roleAssignments,
  services,
  severities,
  withTenant,
  workspaces,
  type Tx,
} from "@openincident/db";
import {
  TEAMS_HELP_TEXT,
  cardActivity,
  completeTeamsPairing,
  declareCard,
  escalateCard,
  getTeamsInstall,
  incidentCard,
  incidentForTeamsChannel,
  incidentHeaderCard,
  markTeamsDmAcknowledged,
  memberForTeamsUser,
  postIncidentNoteAll,
  recordChatEvent,
  teamsConnector,
  textActivity,
  updateCard,
  type TeamsInstall,
} from "@openincident/chat";
import { approveAction, setKillSwitch, stopIncident, undoAction } from "@/lib/atlas/control";
import { startEscalation, tenantOrigin } from "@openincident/oncall";
import { ackByToken } from "@/lib/ack";
import {
  afterIncidentChange,
  declareIncidentCore,
  postUpdateCore,
  type Actor,
} from "@/lib/incident-writes";
import { resolveLocale } from "@/i18n/locales";
import { buildTranslate } from "@/i18n/server";

export type TeamsActivity = {
  type: string;
  /** Invoke activities: what is invoked (composeExtension/submitAction…). */
  name?: string;
  id?: string;
  text?: string;
  value?: Record<string, unknown>;
  replyToId?: string;
  serviceUrl?: string;
  from?: { id?: string; name?: string; aadObjectId?: string };
  recipient?: { id?: string };
  conversation?: { id: string; conversationType?: string; tenantId?: string };
  channelData?: {
    tenant?: { id?: string };
    team?: { id?: string; name?: string; aadGroupId?: string };
    channel?: { id?: string; name?: string };
    eventType?: string;
  };
  membersAdded?: Array<{ id?: string }>;
  entities?: Array<{ type?: string; text?: string; mentioned?: { id?: string; name?: string } }>;
};

type Ctx = { tenantId: string; origin: string; install: TeamsInstall };

/** Strips the bot mention Teams prepends when the bot is addressed in a channel. */
function commandText(a: TeamsActivity): string {
  let text = a.text ?? "";
  for (const e of a.entities ?? [])
    if (e.type === "mention" && e.text) text = text.replace(e.text, "");
  return text
    .replace(/<at>[^<]*<\/at>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function contextFor(a: TeamsActivity): Promise<Ctx | null> {
  const teamId = a.channelData?.team?.aadGroupId ?? a.channelData?.team?.id;
  const aad = a.channelData?.tenant?.id ?? a.conversation?.tenantId;
  const tenantId =
    (teamId ? await getTenantIdForApiKeyHash(`teams:${teamId}`) : null) ??
    (aad ? await getTenantIdForApiKeyHash(`teams-aad:${aad}`) : null);
  if (!tenantId) return null;
  const tenant = await getTenantById(tenantId);
  if (!tenant) return null;
  const install = await withTenant(tenantId, (tx) => getTeamsInstall(tx, tenantId));
  if (!install) return null;
  return { tenantId, origin: tenantOrigin(tenant.slug, tenant.customDomain), install };
}

function reply(a: TeamsActivity, activity: Record<string, unknown>) {
  if (!a.serviceUrl || !a.conversation) return Promise.resolve(null);
  return teamsConnector.post(a.serviceUrl, a.conversation.id, activity);
}

async function actorFor(
  tx: Tx,
  ctx: Ctx,
  a: TeamsActivity,
): Promise<(Actor & { role: string; email: string }) | null> {
  const m = await memberForTeamsUser(tx, ctx.tenantId, ctx.install, {
    aadObjectId: a.from?.aadObjectId ?? null,
  });
  return m ? { kind: "member", memberId: m.id, name: m.name, role: m.role, email: m.email } : null;
}

async function declareOptions(tx: Tx, tenantId: string) {
  const types = await tx
    .select({ id: incidentTypes.id, name: incidentTypes.name, isDefault: incidentTypes.isDefault })
    .from(incidentTypes)
    .where(eq(incidentTypes.tenantId, tenantId))
    .orderBy(asc(incidentTypes.name));
  const sevs = await tx
    .select({ id: severities.id, name: severities.name })
    .from(severities)
    .where(eq(severities.tenantId, tenantId))
    .orderBy(asc(severities.rank));
  // Only the services the workspace has adopted: the card is a short list to
  // pick from, not everything a signal has ever named.
  const svcRows = await tx
    .select({ id: services.id, name: services.key })
    .from(services)
    .where(and(eq(services.tenantId, tenantId), eq(services.confirmed, true)))
    .orderBy(asc(services.key));
  return {
    types,
    severities: sevs,
    services: svcRows,
    defaultTypeId: types.find((t) => t.isDefault)?.id ?? types[0]?.id ?? null,
  };
}

async function workspaceT(tx: Tx, tenantId: string) {
  const [ws] = await tx
    .select({ locale: workspaces.locale, timezone: workspaces.timezone })
    .from(workspaces)
    .where(eq(workspaces.tenantId, tenantId));
  return buildTranslate(resolveLocale(ws?.locale), ws?.timezone ?? "Europe/Paris");
}

/** The pairing code typed in a team's channel binds that team to the workspace that issued the code. */
async function handlePairing(a: TeamsActivity, code: string): Promise<void> {
  const tenantId = await getTenantIdForApiKeyHash(`teams-pair:${code.toUpperCase()}`);
  const team = a.channelData?.team;
  const aad = a.channelData?.tenant?.id ?? a.conversation?.tenantId;
  const channelId = a.channelData?.channel?.id ?? a.conversation?.id?.split(";")[0];
  if (!tenantId || !team?.id || !aad || !a.serviceUrl || !channelId) {
    await reply(
      a,
      textActivity(
        "That code is unknown or expired, or this is not a team channel. Generate a new one in Open Incident → Settings → Slack & Teams, and type it here from a channel of the team to pair.",
      ),
    );
    return;
  }
  // The organisation's domain, read from the address of the person who typed
  // the code — what the settings show as "tenant skylark.io". Best effort.
  let tenantDomain: string | null = null;
  if (a.from?.aadObjectId) {
    const roster = await teamsConnector
      .members(a.serviceUrl, team.id)
      .catch(() => ({ ok: false as const, error: "" }));
    if (roster.ok) {
      const me = roster.value.find((m) => m.aadObjectId === a.from?.aadObjectId);
      const address = me?.email ?? me?.userPrincipalName ?? "";
      tenantDomain = address.includes("@") ? address.split("@")[1]!.toLowerCase() : null;
    }
  }
  const install = await completeTeamsPairing(tenantId, code, {
    teamId: team.aadGroupId ?? team.id,
    teamName: team.name ?? "Microsoft Teams",
    aadTenantId: aad,
    serviceUrl: a.serviceUrl,
    generalChannelId: channelId,
    tenantDomain,
  });
  await reply(
    a,
    textActivity(
      install
        ? `✅ This team is now paired with Open Incident (**${install.teamName}**). Incident channels and announcements will appear here.`
        : "That code is unknown or expired. Generate a new one in Open Incident and type it again.",
    ),
  );
}

/** One activity in, zero or more Connector calls out. Never throws on a user mistake: it answers. */
export async function handleTeamsActivity(a: TeamsActivity): Promise<void> {
  if (a.type === "conversationUpdate") {
    const botAdded = (a.membersAdded ?? []).some(
      (m) => m.id && a.recipient?.id && m.id === a.recipient.id,
    );
    if (botAdded)
      await reply(
        a,
        textActivity(
          "Hello — I am Open Incident. An admin pairs this team from Open Incident → Settings → Slack & Teams: type `pair <code>` here.",
        ),
      );
    return;
  }
  if (a.type !== "message") return;
  const text = commandText(a);
  // The settings show the code split for reading (4K7Q-2M); either way is accepted.
  const pair = text.match(/^pair\s+([A-Za-z0-9]{3,4})-?([A-Za-z0-9]{2,3})$/i);
  if (pair && `${pair[1]}${pair[2]}`.length === 6) return handlePairing(a, `${pair[1]}${pair[2]}`);

  const ctx = await contextFor(a);
  if (!ctx) {
    await reply(
      a,
      textActivity(
        "This team is not paired with an Open Incident workspace yet. An admin types `pair <code>` from the workspace's settings.",
      ),
    );
    return;
  }
  // Card submissions arrive as messages carrying `value`.
  if (a.value && typeof a.value.action === "string")
    return handleSubmit(ctx, a, a.value as { action: string } & Record<string, unknown>);

  const [cmd = "help", ...rest] = text.split(" ");
  const arg = rest.join(" ").trim();
  await withTenant(ctx.tenantId, async (tx) => {
    const actor = await actorFor(tx, ctx, a);
    const here = a.conversation
      ? await incidentForTeamsChannel(tx, ctx.tenantId, a.conversation.id)
      : null;
    await recordChatEvent(
      ctx.tenantId,
      {
        provider: "teams",
        direction: "in",
        kind: "command",
        target: a.channelData?.channel?.name ?? null,
        detail: `@Open Incident ${[cmd, ...(cmd.toLowerCase() === "atlas" ? rest.slice(0, 2) : [])].join(" ")}`,
        incidentId: here?.id ?? null,
        memberId: actor?.memberId ?? null,
      },
      tx,
    );
    switch (cmd.toLowerCase()) {
      case "atlas": {
        if (!actor || !canRespond(actor))
          return reply(a, textActivity("Only responders can stop or approve Atlas."));
        const verb = (rest[0] ?? "").toLowerCase();
        const all = (rest[1] ?? "").toLowerCase() === "all";
        const by = { memberId: actor.memberId, label: actor.name };
        if (verb === "stop" && all) {
          await setKillSwitch(ctx.tenantId, true, by);
          return reply(
            a,
            textActivity(
              "Atlas is stopped everywhere: it proposes and acts on no incident until an admin resumes it in Settings › Atlas.",
            ),
          );
        }
        if (verb === "stop") {
          if (!here)
            return reply(
              a,
              textActivity(
                "Use `atlas stop` from an incident's channel — or `atlas stop all` to stop Atlas everywhere.",
              ),
            );
          const withdrawn = await stopIncident(ctx.tenantId, here.id, by);
          queueAfter(() =>
            postIncidentNoteAll(
              ctx.tenantId,
              here.id,
              `✦ ${actor.name} stopped Atlas on INC-${here.number}.`,
            ),
          );
          return reply(
            a,
            textActivity(
              `Atlas is stopped on INC-${here.number}${withdrawn ? ` — ${withdrawn} proposal${withdrawn === 1 ? "" : "s"} withdrawn` : ""}. It stays stopped until someone resumes it from the incident.`,
            ),
          );
        }
        if (verb === "approve") {
          if (!here)
            return reply(a, textActivity("Use `atlas approve` from the incident's channel."));
          const [waiting] = await tx
            .select({ id: atlasActions.id, title: atlasActions.title })
            .from(atlasActions)
            .where(
              and(
                eq(atlasActions.tenantId, ctx.tenantId),
                eq(atlasActions.incidentId, here.id),
                eq(atlasActions.approvalState, "waiting"),
              ),
            )
            .orderBy(desc(atlasActions.at))
            .limit(1);
          if (!waiting)
            return reply(a, textActivity(`Atlas has no proposal waiting on INC-${here.number}.`));
          queueAfter(() =>
            approveAction(ctx.tenantId, waiting.id, by)
              .then(() => null)
              .catch((err: unknown) =>
                reply(
                  a,
                  textActivity(
                    `The approval could not go through (${err instanceof Error ? err.message : String(err)}). Nothing ran — approve it from the incident's Atlas tab.`,
                  ),
                ),
              ),
          );
          return reply(
            a,
            textActivity(
              `Approving “${waiting.title}” — Atlas runs it and says so in this channel.`,
            ),
          );
        }
        return reply(
          a,
          textActivity(
            "`atlas stop` stops Atlas on this incident, `atlas stop all` everywhere, `atlas approve` approves the fix it proposed.",
          ),
        );
      }
      case "declare":
      case "new": {
        if (!actor || !canRespond(actor))
          return reply(a, textActivity("Only members of the workspace can declare incidents."));
        const opts = await declareOptions(tx, ctx.tenantId);
        const card = declareCard({
          types: opts.types.map((x) => ({ title: x.name, value: x.id })),
          severities: opts.severities.map((x) => ({ title: x.name, value: x.id })),
          services: opts.services.map((x) => ({ title: x.name, value: x.id })),
          defaultTypeId: opts.defaultTypeId,
        });
        if (arg)
          (card as { body: Array<Record<string, unknown>> }).body.find(
            (b) => b.id === "name",
          )!.value = arg;
        return reply(a, cardActivity(card, "Declare an incident"));
      }
      case "update": {
        if (!actor || !canRespond(actor))
          return reply(a, textActivity("Only responders can post updates."));
        const inc = a.conversation
          ? await incidentForTeamsChannel(tx, ctx.tenantId, a.conversation.id)
          : null;
        if (!inc) return reply(a, textActivity("Use `update` from an incident's channel."));
        const [row] = await tx
          .select({ typeId: incidents.typeId, statusId: incidents.statusId })
          .from(incidents)
          .where(eq(incidents.id, inc.id));
        const statuses = row
          ? await tx
              .select({ id: incidentStatuses.id, name: incidentStatuses.name })
              .from(incidentStatuses)
              .where(eq(incidentStatuses.typeId, row.typeId))
              .orderBy(asc(incidentStatuses.rank))
          : [];
        return reply(
          a,
          cardActivity(
            updateCard({
              reference: `INC-${inc.number}`,
              statuses: statuses.map((s) => ({ title: s.name, value: s.id })),
              currentStatusId: row?.statusId ?? null,
            }),
            `Update INC-${inc.number}`,
          ),
        );
      }
      case "escalate": {
        if (!actor || !canRespond(actor))
          return reply(a, textActivity("Only responders can escalate."));
        const inc = a.conversation
          ? await incidentForTeamsChannel(tx, ctx.tenantId, a.conversation.id)
          : null;
        if (!inc) return reply(a, textActivity("Use `escalate` from an incident's channel."));
        const paths = await tx
          .select({ id: escalationPaths.id, name: escalationPaths.name })
          .from(escalationPaths)
          .where(
            and(
              eq(escalationPaths.tenantId, ctx.tenantId),
              isNotNull(escalationPaths.currentVersionId),
            ),
          )
          .orderBy(asc(escalationPaths.name));
        if (paths.length === 0)
          return reply(a, textActivity("No published escalation path in this workspace."));
        return reply(
          a,
          cardActivity(
            escalateCard({
              reference: `INC-${inc.number}`,
              paths: paths.map((p) => ({ title: p.name, value: p.id })),
            }),
            `Escalate INC-${inc.number}`,
          ),
        );
      }
      case "lead":
      case "role": {
        if (!actor || !canRespond(actor))
          return reply(a, textActivity("Only responders can assign roles."));
        const inc = a.conversation
          ? await incidentForTeamsChannel(tx, ctx.tenantId, a.conversation.id)
          : null;
        if (!inc) return reply(a, textActivity("Use `lead @Name` from an incident's channel."));
        const mentioned = (a.entities ?? []).find(
          (e) => e.type === "mention" && e.mentioned?.id && e.mentioned.id !== a.recipient?.id,
        )?.mentioned;
        const matched = mentioned
          ? await memberForTeamsUser(tx, ctx.tenantId, ctx.install, {
              aadObjectId: mentioned.id ?? null,
            })
          : null;
        const target = matched
          ? { id: matched.id, name: matched.name }
          : mentioned || !actor.memberId
            ? null
            : { id: actor.memberId, name: actor.name };
        if (!target)
          return reply(
            a,
            textActivity("I could not match that person to a member of the workspace."),
          );
        const [lead] = await tx
          .select({ id: incidentRoles.id, name: incidentRoles.name })
          .from(incidentRoles)
          .where(and(eq(incidentRoles.tenantId, ctx.tenantId), eq(incidentRoles.isLead, true)));
        if (!lead) return reply(a, textActivity("This workspace has no lead role."));
        await tx
          .delete(roleAssignments)
          .where(and(eq(roleAssignments.incidentId, inc.id), eq(roleAssignments.roleId, lead.id)));
        await tx.insert(roleAssignments).values({
          tenantId: ctx.tenantId,
          incidentId: inc.id,
          roleId: lead.id,
          memberId: target.id,
        });
        await tx.insert(incidentEvents).values({
          tenantId: ctx.tenantId,
          incidentId: inc.id,
          kind: "role_assigned",
          actorKind: "member",
          actorMemberId: actor.memberId,
          actorName: actor.name,
          payload: { role: lead.name, name: target.name },
        });
        queueAfter(() => afterIncidentChange(ctx.tenantId, inc.id, ["incident.updated"], {}));
        return reply(
          a,
          textActivity(`**${target.name}** is now ${lead.name} of INC-${inc.number}.`),
        );
      }
      case "status": {
        const inc = a.conversation
          ? await incidentForTeamsChannel(tx, ctx.tenantId, a.conversation.id)
          : null;
        if (!inc) return reply(a, textActivity("Use `status` from an incident's channel."));
        const card = await incidentCard(tx, ctx.tenantId, inc.id, ctx.origin);
        return card
          ? reply(a, cardActivity(incidentHeaderCard(card), `${card.reference} — ${card.name}`))
          : null;
      }
      default:
        return reply(a, textActivity(TEAMS_HELP_TEXT));
    }
  });
  await flushAfter();
}

const pending: Array<() => Promise<unknown>> = [];
function queueAfter(fn: () => Promise<unknown>) {
  pending.push(fn);
}
async function flushAfter() {
  const work = pending.splice(0, pending.length);
  for (const fn of work)
    await fn().catch((err) => console.error("[teams] post-commit work failed:", err));
}

/** Adaptive Card submissions: declare, update, escalate, acknowledge. */
async function handleSubmit(
  ctx: Ctx,
  a: TeamsActivity,
  value: { action: string } & Record<string, unknown>,
): Promise<void> {
  const str = (k: string) => (typeof value[k] === "string" ? (value[k] as string).trim() : "");
  if (value.action === "oi_ack") {
    const token = str("token");
    const r = await ackByToken(ctx.tenantId, token, "teams");
    if (r.ok && a.conversation && a.replyToId) {
      await markTeamsDmAcknowledged(
        ctx.tenantId,
        `${a.conversation.id}|${a.replyToId}`,
        r.incidentNumber ? `INC-${r.incidentNumber} — ${r.name ?? ""}` : (r.name ?? "Page"),
        a.from?.name ?? "you",
      );
    } else if (!r.ok) {
      await reply(
        a,
        textActivity(
          r.already ? "Already acknowledged." : "This page can no longer be acknowledged.",
        ),
      );
    }
    return;
  }
  await withTenant(ctx.tenantId, async (tx) => {
    const actor = await actorFor(tx, ctx, a);
    if (!actor || !canRespond(actor)) return reply(a, textActivity("Only responders can do that."));
    const by = { memberId: actor.memberId, label: actor.name };
    if (value.action === "oi_atlas_undo") {
      const actionId = str("actionId");
      const [row] = await tx
        .select({ title: atlasActions.title, incidentId: atlasActions.incidentId })
        .from(atlasActions)
        .where(and(eq(atlasActions.tenantId, ctx.tenantId), eq(atlasActions.id, actionId)));
      if (!row) return reply(a, textActivity("That action is no longer in Atlas's journal."));
      queueAfter(() =>
        undoAction(ctx.tenantId, actionId, by)
          .then(() =>
            row.incidentId
              ? postIncidentNoteAll(
                  ctx.tenantId,
                  row.incidentId,
                  `↩ ${actor.name} undid: ${row.title}`,
                )
              : null,
          )
          .catch((err: unknown) =>
            reply(
              a,
              textActivity(
                `The undo could not go through (${err instanceof Error ? err.message : String(err)}). Undo it from the incident's Atlas tab.`,
              ),
            ),
          ),
      );
      return;
    }
    if (value.action === "oi_atlas_stop") {
      const incidentId = str("incidentId");
      const [inc] = await tx
        .select({ id: incidents.id, number: incidents.number })
        .from(incidents)
        .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incidentId)));
      if (!inc) return;
      queueAfter(async () => {
        const withdrawn = await stopIncident(ctx.tenantId, inc.id, by);
        await postIncidentNoteAll(
          ctx.tenantId,
          inc.id,
          `✦ ${actor.name} stopped Atlas on INC-${inc.number}${withdrawn ? ` — ${withdrawn} proposal${withdrawn === 1 ? "" : "s"} withdrawn` : ""}.`,
        );
      });
      return;
    }
    if (value.action === "oi_atlas_draft_publish" || value.action === "oi_atlas_draft_edit") {
      const incidentId = str("incidentId");
      const message = str("message");
      const [inc] = await tx
        .select()
        .from(incidents)
        .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, incidentId)));
      if (!inc || inc.phase === "closed" || !message)
        return reply(a, textActivity("The draft can no longer be published."));
      if (value.action === "oi_atlas_draft_edit") {
        const statuses = await tx
          .select({ id: incidentStatuses.id, name: incidentStatuses.name })
          .from(incidentStatuses)
          .where(eq(incidentStatuses.typeId, inc.typeId))
          .orderBy(asc(incidentStatuses.rank));
        return reply(
          a,
          cardActivity(
            updateCard({
              reference: `INC-${inc.number}`,
              statuses: statuses.map((x) => ({ title: x.name, value: x.id })),
              currentStatusId: inc.statusId,
              initialMessage: message,
            }),
            `Update INC-${inc.number}`,
          ),
        );
      }
      if (!inc.statusId) return reply(a, textActivity("The incident has no status yet."));
      const t = await workspaceT(tx, ctx.tenantId);
      const r = await postUpdateCore(tx, ctx.tenantId, actor, inc.id, {
        statusId: inc.statusId,
        message,
        severityId: null,
        nextUpdateMinutes: null,
        resolvedLabel: t("incident.update.resolved"),
      });
      if (!r) return reply(a, textActivity("The update was refused."));
      queueAfter(() =>
        afterIncidentChange(ctx.tenantId, inc.id, ["incident.update_published"], {
          message,
          by: actor.name,
        }),
      );
      return reply(
        a,
        textActivity(`Update published on INC-${inc.number} — by ${actor.name}, drafted by Atlas.`),
      );
    }
    if (value.action === "oi_declare") {
      const name = str("name");
      if (name.length < 3) return reply(a, textActivity("A title is required."));
      const typeId = str("typeId");
      let created: { id: string; number: number };
      try {
        created = await declareIncidentCore(tx, ctx.tenantId, actor, {
          name,
          summary: str("summary") || undefined,
          mode: "live",
          typeId,
          severityId: str("severityId") || undefined,
          serviceId: str("serviceId") || undefined,
          customFields: {},
          source: "chat",
        });
      } catch (err) {
        return reply(
          a,
          textActivity(`Could not declare: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
      queueAfter(() => afterIncidentChange(ctx.tenantId, created.id, ["incident.created"], {}));
      return reply(
        a,
        textActivity(
          `✅ **INC-${created.number} — ${name}** declared. ${ctx.origin}/app/incidents/${created.number}`,
        ),
      );
    }
    if (value.action === "oi_update_open" || value.action === "oi_escalate_open") {
      const inc = a.conversation
        ? await incidentForTeamsChannel(tx, ctx.tenantId, a.conversation.id)
        : null;
      if (!inc) return reply(a, textActivity("Use this from the incident's channel."));
      if (value.action === "oi_update_open") {
        const [row] = await tx
          .select({ typeId: incidents.typeId, statusId: incidents.statusId })
          .from(incidents)
          .where(eq(incidents.id, inc.id));
        const statuses = row
          ? await tx
              .select({ id: incidentStatuses.id, name: incidentStatuses.name })
              .from(incidentStatuses)
              .where(eq(incidentStatuses.typeId, row.typeId))
              .orderBy(asc(incidentStatuses.rank))
          : [];
        return reply(
          a,
          cardActivity(
            updateCard({
              reference: `INC-${inc.number}`,
              statuses: statuses.map((s) => ({ title: s.name, value: s.id })),
              currentStatusId: row?.statusId ?? null,
            }),
            `Update INC-${inc.number}`,
          ),
        );
      }
      const paths = await tx
        .select({ id: escalationPaths.id, name: escalationPaths.name })
        .from(escalationPaths)
        .where(
          and(
            eq(escalationPaths.tenantId, ctx.tenantId),
            isNotNull(escalationPaths.currentVersionId),
          ),
        )
        .orderBy(asc(escalationPaths.name));
      if (paths.length === 0)
        return reply(a, textActivity("No published escalation path in this workspace."));
      return reply(
        a,
        cardActivity(
          escalateCard({
            reference: `INC-${inc.number}`,
            paths: paths.map((p) => ({ title: p.name, value: p.id })),
          }),
          `Escalate INC-${inc.number}`,
        ),
      );
    }
    const reference = str("reference");
    const number = Number(reference.replace(/^INC-/, ""));
    const [inc] = await tx
      .select({ id: incidents.id, number: incidents.number })
      .from(incidents)
      .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.number, number)));
    if (!inc) return reply(a, textActivity("Unknown incident."));
    if (value.action === "oi_update") {
      const message = str("message");
      if (!message) return reply(a, textActivity("A message is required."));
      const statusId = str("statusId");
      const t = await workspaceT(tx, ctx.tenantId);
      if (!statusId) return reply(a, textActivity("Choose a status."));
      const r = await postUpdateCore(tx, ctx.tenantId, actor, inc.id, {
        statusId,
        message,
        severityId: null,
        nextUpdateMinutes: null,
        resolvedLabel: t("incident.update.resolved"),
      });
      if (!r) return reply(a, textActivity("The update was refused."));
      const events: Array<"incident.update_published" | "incident.updated" | "incident.resolved"> =
        ["incident.update_published"];
      if (r.statusChanged) events.push("incident.updated");
      if (r.resolved) events.push("incident.resolved");
      queueAfter(() =>
        afterIncidentChange(ctx.tenantId, inc.id, events, { message, by: actor.name }),
      );
      return reply(a, textActivity(`Update posted on INC-${inc.number}.`));
    }
    if (value.action === "oi_escalate") {
      const pathId = str("pathId");
      if (!pathId) return reply(a, textActivity("Choose a path."));
      queueAfter(() =>
        startEscalation(ctx.tenantId, {
          pathId,
          incidentId: inc.id,
          triggeredBy: { kind: "member", memberId: actor.memberId, name: actor.name },
        }),
      );
      return reply(a, textActivity(`Escalation started on INC-${inc.number}.`));
    }
    return reply(a, textActivity(TEAMS_HELP_TEXT));
  });
  await flushAfter();
}

/**
 * "Add to the timeline" — the message action of the Teams app (the design's
 * "Pin the message"): the message lands on the incident's timeline as a
 * pinned note, like a :pushpin: reaction in Slack. An invoke wants its answer
 * in the HTTP response, so this one runs before the route answers.
 */
export async function handleTeamsInvoke(a: TeamsActivity): Promise<Record<string, unknown>> {
  const value = (a.value ?? {}) as {
    commandId?: string;
    messagePayload?: {
      id?: string;
      body?: { content?: string };
      linkToMessage?: string;
    };
  };
  if (a.name !== "composeExtension/submitAction" || value.commandId !== "oi_pin") return {};
  const ctx = await contextFor(a);
  if (!ctx) return {};
  const text = (value.messagePayload?.body?.content ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return {};
  await withTenant(ctx.tenantId, async (tx) => {
    const inc = a.conversation
      ? await incidentForTeamsChannel(tx, ctx.tenantId, a.conversation.id)
      : null;
    if (!inc) return;
    const actor = await actorFor(tx, ctx, a);
    if (!actor || !canRespond(actor)) return;
    const now = new Date();
    await tx.insert(incidentEvents).values({
      tenantId: ctx.tenantId,
      incidentId: inc.id,
      kind: "note",
      actorKind: "member",
      actorMemberId: actor.memberId,
      actorName: actor.name,
      pinned: true,
      payload: {
        system: "chat_pin",
        message: text.slice(0, 4000),
        permalink: value.messagePayload?.linkToMessage ?? null,
        channel: "teams",
      },
      occurredAt: now,
    });
    await tx.update(incidents).set({ lastActivityAt: now }).where(eq(incidents.id, inc.id));
    await recordChatEvent(
      ctx.tenantId,
      {
        provider: "teams",
        direction: "in",
        kind: "pin",
        target: a.channelData?.channel?.name ?? `inc-${inc.number}`,
        incidentId: inc.id,
        memberId: actor.memberId,
      },
      tx,
    );
  });
  return {};
}
