/**
 * The Teams surface, server side: which workspace an activity belongs to,
 * and what each message or card submission does. Every gesture ends in the
 * same write path as the web — declareIncidentCore, postUpdateCore,
 * startEscalation, role assignment — the adapter translates, it does not decide.
 */
import { canRespond } from "@openincident/config";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import {
  catalogEntries,
  catalogTypes,
  escalationPaths,
  getTenantById,
  getTenantIdForApiKeyHash,
  incidentEvents,
  incidentRoles,
  incidentStatuses,
  incidentTypes,
  incidents,
  roleAssignments,
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
  teamsConnector,
  textActivity,
  updateCard,
  type TeamsInstall,
} from "@openincident/chat";
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
  const [svcType] = await tx
    .select({ id: catalogTypes.id })
    .from(catalogTypes)
    .where(and(eq(catalogTypes.tenantId, tenantId), eq(catalogTypes.key, "service")));
  const services = svcType
    ? await tx
        .select({ id: catalogEntries.id, name: catalogEntries.name })
        .from(catalogEntries)
        .where(eq(catalogEntries.typeId, svcType.id))
        .orderBy(asc(catalogEntries.name))
    : [];
  return {
    types,
    severities: sevs,
    services,
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
        "That code is unknown or expired, or this is not a team channel. Generate a new one in Open Incident → Settings → Integrations → Microsoft Teams, and type it here from a channel of the team to pair.",
      ),
    );
    return;
  }
  const install = await completeTeamsPairing(tenantId, code, {
    teamId: team.aadGroupId ?? team.id,
    teamName: team.name ?? "Microsoft Teams",
    aadTenantId: aad,
    serviceUrl: a.serviceUrl,
    generalChannelId: channelId,
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
          "Hello — I am Open Incident. An admin pairs this team from Open Incident → Settings → Integrations → Microsoft Teams: type `pair <code>` here.",
        ),
      );
    return;
  }
  if (a.type !== "message") return;
  const text = commandText(a);
  const pair = text.match(/^pair\s+([A-Za-z0-9]{6})$/i);
  if (pair) return handlePairing(a, pair[1]!);

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
    const t = await workspaceT(tx, ctx.tenantId);
    void t;
    const actor = await actorFor(tx, ctx, a);
    switch (cmd.toLowerCase()) {
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
          serviceEntryId: str("serviceEntryId") || undefined,
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
