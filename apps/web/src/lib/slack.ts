/**
 * The Slack surface, server side: the workspace behind a Slack team, and the
 * handlers of slash commands, interactions and events. Every gesture ends in
 * the same write path as the web — declareIncidentCore, postUpdateCore,
 * startEscalation, role assignment — the adapter translates, it does not decide.
 */
import { canRespond } from "@openincident/config";
import { after } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import {
  catalogEntries,
  catalogTypes,
  escalationPaths,
  followUps,
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
  type Tx,
} from "@openincident/db";
import {
  HELP_TEXT,
  declareModal,
  escalateModal,
  getSlackInstall,
  incidentCard,
  incidentForChannel,
  markDmAcknowledged,
  memberForSlackUser,
  readViewValues,
  slack,
  updateModal,
  type SlackInstall,
} from "@openincident/chat";
import { startEscalation, tenantOrigin } from "@openincident/oncall";
import { ackByToken } from "@/lib/ack";
import {
  addFollowUpCore,
  afterIncidentChange,
  declareIncidentCore,
  postUpdateCore,
  type Actor,
} from "@/lib/incident-writes";
import { resolveLocale } from "@/i18n/locales";
import { buildTranslate } from "@/i18n/server";
import { workspaces } from "@openincident/db";

export type SlackContext = { tenantId: string; origin: string; install: SlackInstall };

/** The workspace behind a Slack team id — registered at install time in the directory lookup. */
export async function slackContextForTeam(teamId: string): Promise<SlackContext | null> {
  const tenantId = await getTenantIdForApiKeyHash(`slack:${teamId}`);
  if (!tenantId) return null;
  const tenant = await getTenantById(tenantId);
  if (!tenant) return null;
  const install = await withTenant(tenantId, (tx) => getSlackInstall(tx, tenantId));
  if (!install || install.teamId !== teamId) return null;
  return { tenantId, origin: tenantOrigin(tenant.slug, tenant.customDomain), install };
}

type Ephemeral = { response_type: "ephemeral"; text: string };
type Post = Array<() => Promise<unknown>>;

/** Work that must run after the transaction committed — and after Slack got its answer. */
function runAfter(post: Post): void {
  for (const f of post)
    after(() => f().catch((err) => console.error("[slack] post-commit work failed", err)));
}
const say = (text: string): Ephemeral => ({ response_type: "ephemeral", text });

async function actorFor(
  tx: Tx,
  ctx: SlackContext,
  slackUserId: string,
): Promise<(Actor & { role: string; email: string }) | null> {
  const m = await memberForSlackUser(tx, ctx.tenantId, slack(ctx.install.token), slackUserId);
  return m ? { kind: "member", memberId: m.id, name: m.name, role: m.role, email: m.email } : null;
}

async function declareOptions(tx: Tx, tenantId: string) {
  const [type] = await tx
    .select()
    .from(incidentTypes)
    .where(and(eq(incidentTypes.tenantId, tenantId), eq(incidentTypes.isDefault, true)));
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
    type: type ?? null,
    severities: sevs,
    services,
    requireService: Boolean(type?.declareForm.find((f) => f.key === "service")?.required),
  };
}

/** `/incident <subcommand> …` — answers within Slack's three seconds; modals open for anything longer. */
export async function handleSlashCommand(
  ctx: SlackContext,
  form: Record<string, string>,
): Promise<Ephemeral | null> {
  const text = (form.text ?? "").trim();
  const [sub = "help", ...rest] = text.split(/\s+/);
  const arg = rest.join(" ").trim();
  const api = slack(ctx.install.token);
  const post: Post = [];
  const reply = await withTenant(ctx.tenantId, async (tx) => {
    const actor = await actorFor(tx, ctx, form.user_id ?? "");
    if (!actor)
      return say(
        "Your Slack email does not match a member of this workspace. Sign in to Open Incident with the same address first.",
      );
    const inChannel = form.channel_id
      ? await incidentForChannel(tx, ctx.tenantId, form.channel_id)
      : null;
    switch (sub.toLowerCase()) {
      case "declare":
      case "new": {
        if (!canRespond(actor)) return say("Viewers cannot declare incidents.");
        const opts = await declareOptions(tx, ctx.tenantId);
        if (!opts.type) return say("No default incident type — configure one in Settings → Types.");
        if (!form.trigger_id) return say("Slack sent no trigger — try again.");
        const r = await api.openView(
          form.trigger_id,
          declareModal({
            title: arg,
            severities: opts.severities,
            services: opts.services,
            requireService: opts.requireService,
            privateMetadata: JSON.stringify({ channel: form.channel_id ?? null }),
          }),
        );
        return r.ok ? null : say(`Could not open the form (${r.error}).`);
      }
      case "update": {
        if (!inChannel) return say("Run this in an incident channel (#inc-…).");
        if (!canRespond(actor)) return say("Viewers cannot publish updates.");
        const [inc] = await tx.select().from(incidents).where(eq(incidents.id, inChannel.id));
        if (!inc || inc.phase === "closed") return say("This incident is closed.");
        if (arg) {
          if (!inc.statusId)
            return say("The incident has no status yet — use the form: `/incident update`.");
          const t = await workspaceT(tx, ctx.tenantId);
          const result = await postUpdateCore(tx, ctx.tenantId, actor, inc.id, {
            statusId: inc.statusId,
            message: arg,
            severityId: null,
            nextUpdateMinutes: null,
            resolvedLabel: t("incident.update.resolved"),
          });
          if (!result) return say("The update could not be applied.");
          post.push(() =>
            afterIncidentChange(ctx.tenantId, inc.id, ["incident.update_published"], {
              message: arg,
              by: actor.name,
            }),
          );
          return say(`Update published on INC-${inc.number}.`);
        }
        const statuses = await tx
          .select({ id: incidentStatuses.id, name: incidentStatuses.name })
          .from(incidentStatuses)
          .where(eq(incidentStatuses.typeId, inc.typeId))
          .orderBy(asc(incidentStatuses.rank));
        const sevs = await tx
          .select({ id: severities.id, name: severities.name })
          .from(severities)
          .where(eq(severities.tenantId, ctx.tenantId))
          .orderBy(asc(severities.rank));
        if (!form.trigger_id) return say("Slack sent no trigger — try again.");
        const r = await api.openView(
          form.trigger_id,
          updateModal({
            reference: `INC-${inc.number}`,
            statuses,
            currentStatusId: inc.statusId,
            severities: sevs,
            privateMetadata: JSON.stringify({ incidentId: inc.id }),
          }),
        );
        return r.ok ? null : say(`Could not open the form (${r.error}).`);
      }
      case "escalate": {
        if (!inChannel) return say("Run this in an incident channel (#inc-…).");
        if (!canRespond(actor)) return say("Viewers cannot escalate.");
        const paths = await tx
          .select({
            id: escalationPaths.id,
            name: escalationPaths.name,
            currentVersionId: escalationPaths.currentVersionId,
          })
          .from(escalationPaths)
          .where(eq(escalationPaths.tenantId, ctx.tenantId))
          .orderBy(asc(escalationPaths.name));
        const published = paths.filter((p) => p.currentVersionId);
        if (published.length === 0) return say("No published escalation path.");
        if (!form.trigger_id) return say("Slack sent no trigger — try again.");
        const r = await api.openView(
          form.trigger_id,
          escalateModal({
            reference: `INC-${inChannel.number}`,
            paths: published,
            privateMetadata: JSON.stringify({ incidentId: inChannel.id }),
          }),
        );
        return r.ok ? null : say(`Could not open the form (${r.error}).`);
      }
      case "lead":
      case "role": {
        if (!inChannel) return say("Run this in an incident channel (#inc-…).");
        if (!canRespond(actor)) return say("Viewers cannot assign roles.");
        const mention = /<@([A-Z0-9]+)(?:\|[^>]*)?>/.exec(text);
        const roleName =
          sub.toLowerCase() === "lead"
            ? null
            : rest
                .filter((w) => !w.startsWith("<@"))
                .join(" ")
                .trim();
        if (!mention) return say("Mention who takes the role: `/incident lead @someone`.");
        const target = await memberForSlackUser(tx, ctx.tenantId, api, mention[1]!);
        if (!target) return say("That Slack user is not a member of the workspace.");
        const roles = await tx
          .select()
          .from(incidentRoles)
          .where(eq(incidentRoles.tenantId, ctx.tenantId));
        const role = roleName
          ? roles.find((r) => r.name.toLowerCase() === roleName.toLowerCase())
          : roles.find((r) => r.isLead);
        if (!role)
          return say(`No role named "${roleName}". Roles: ${roles.map((r) => r.name).join(", ")}.`);
        const now = new Date();
        await tx
          .delete(roleAssignments)
          .where(
            and(eq(roleAssignments.incidentId, inChannel.id), eq(roleAssignments.roleId, role.id)),
          );
        await tx.insert(roleAssignments).values({
          tenantId: ctx.tenantId,
          incidentId: inChannel.id,
          roleId: role.id,
          memberId: target.id,
        });
        await tx.insert(incidentEvents).values({
          tenantId: ctx.tenantId,
          incidentId: inChannel.id,
          kind: "role_assigned",
          actorKind: "member",
          actorMemberId: actor.memberId,
          actorName: actor.name,
          payload: { role: role.name, member: target.name, via: "slack" },
          occurredAt: now,
        });
        await tx
          .update(incidents)
          .set({ lastActivityAt: now })
          .where(eq(incidents.id, inChannel.id));
        post.push(() => afterIncidentChange(ctx.tenantId, inChannel.id, ["incident.updated"]));
        return say(`${target.name} is now ${role.name} on INC-${inChannel.number}.`);
      }
      case "status": {
        if (!inChannel)
          return say(
            "Run this in an incident channel (#inc-…), or open the incidents list: " +
              `${ctx.origin}/app/incidents`,
          );
        const card = await incidentCard(tx, ctx.tenantId, inChannel.id, ctx.origin);
        if (!card) return say("Incident not found.");
        return say(
          `*${card.reference} — ${card.name}*\n${[card.severity, card.status ?? card.phase, card.service, card.lead ? `lead ${card.lead}` : "no lead"].filter(Boolean).join(" · ")}\n${card.url}`,
        );
      }
      default:
        return say(HELP_TEXT);
    }
  });
  runAfter(post);
  return reply;
}

async function workspaceT(tx: Tx, tenantId: string) {
  const [ws] = await tx
    .select({ locale: workspaces.locale, timezone: workspaces.timezone })
    .from(workspaces)
    .where(eq(workspaces.tenantId, tenantId));
  return buildTranslate(resolveLocale(ws?.locale), ws?.timezone ?? "Europe/Paris");
}

type ViewSubmission = {
  type: "view_submission";
  user: { id: string };
  view: {
    callback_id: string;
    private_metadata?: string;
    state?: {
      values?: Record<
        string,
        Record<string, { value?: string | null; selected_option?: { value: string } | null }>
      >;
    };
  };
};
type BlockActions = {
  type: "block_actions";
  user: { id: string };
  actions: Array<{ action_id: string; value?: string }>;
  channel?: { id: string };
  message?: { ts: string };
  response_url?: string;
};
type MessageAction = {
  type: "message_action";
  callback_id: string;
  user: { id: string };
  trigger_id: string;
  channel: { id: string };
  message: { text?: string; ts: string; user?: string };
};
export type Interaction = ViewSubmission | BlockActions | MessageAction;

/** Modals submitted, buttons pressed, message shortcuts. */
export async function handleInteraction(
  ctx: SlackContext,
  payload: Interaction,
): Promise<Record<string, unknown> | null> {
  const api = slack(ctx.install.token);
  if (payload.type === "view_submission") {
    const values = readViewValues(payload.view.state);
    const meta = safeJson(payload.view.private_metadata);
    const post: Post = [];
    const reply = await withTenant(ctx.tenantId, async (tx) => {
      const actor = await actorFor(tx, ctx, payload.user.id);
      if (!actor || !canRespond(actor))
        return {
          response_action: "errors",
          errors: { title: "Your Slack account is not a responder of this workspace." },
        };
      if (payload.view.callback_id === "oi_declare") {
        const opts = await declareOptions(tx, ctx.tenantId);
        if (!opts.type)
          return { response_action: "errors", errors: { title: "No default incident type." } };
        if (!values.title || values.title.trim().length < 3)
          return {
            response_action: "errors",
            errors: { title: "Give the incident a title (3 characters at least)." },
          };
        if (opts.requireService && !values.service)
          return {
            response_action: "errors",
            errors: { service: "The type requires the affected service." },
          };
        const created = await declareIncidentCore(tx, ctx.tenantId, actor, {
          name: values.title.trim(),
          summary: values.summary ?? null,
          mode: "live",
          typeId: opts.type.id,
          severityId: values.severity ?? null,
          serviceEntryId: values.service ?? null,
          customFields: {},
          source: "chat",
        });
        post.push(() => afterIncidentChange(ctx.tenantId, created.id, ["incident.created"]));
        if (typeof meta.channel === "string" && meta.channel)
          void api.postEphemeral(
            meta.channel,
            payload.user.id,
            `INC-${created.number} declared — ${ctx.origin}/app/incidents/${created.number}`,
          );
        return { response_action: "clear" };
      }
      if (payload.view.callback_id === "oi_update" && typeof meta.incidentId === "string") {
        const [inc] = await tx
          .select()
          .from(incidents)
          .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, meta.incidentId)));
        if (!inc) return { response_action: "clear" };
        const t = await workspaceT(tx, ctx.tenantId);
        const result = await postUpdateCore(tx, ctx.tenantId, actor, inc.id, {
          statusId: values.status ?? inc.statusId ?? "resolve",
          message: values.message ?? "",
          severityId: values.severity ?? null,
          nextUpdateMinutes: null,
          resolvedLabel: t("incident.update.resolved"),
        });
        if (result) {
          const events: Array<
            "incident.update_published" | "incident.updated" | "incident.resolved"
          > = ["incident.update_published"];
          if (result.statusChanged || result.severityChanged) events.push("incident.updated");
          if (result.resolved) events.push("incident.resolved");
          post.push(() =>
            afterIncidentChange(ctx.tenantId, inc.id, events, {
              message: values.message,
              by: actor.name,
            }),
          );
        }
        return { response_action: "clear" };
      }
      if (
        payload.view.callback_id === "oi_escalate" &&
        typeof meta.incidentId === "string" &&
        values.path
      ) {
        const incidentId = meta.incidentId;
        const pathId = values.path;
        post.push(() =>
          startEscalation(ctx.tenantId, {
            pathId,
            incidentId,
            urgency: "high",
            priorityRank: 0,
            triggeredBy: { kind: "member", memberId: actor.memberId, name: actor.name },
          }).catch((e) => console.error("[slack] escalate", e)),
        );
        return { response_action: "clear" };
      }
      return { response_action: "clear" };
    });
    runAfter(post);
    return reply;
  }
  if (payload.type === "block_actions") {
    for (const action of payload.actions) {
      if (action.action_id === "oi_ack" && action.value) {
        const r = await ackByToken(ctx.tenantId, action.value, "slack");
        if (r.ok && payload.channel && payload.message)
          await markDmAcknowledged(
            ctx.tenantId,
            { channelId: payload.channel.id, ts: payload.message.ts },
            "Escalation",
            r.name ?? "you",
          );
      }
    }
    return null;
  }
  if (payload.type === "message_action") {
    return withTenant(ctx.tenantId, async (tx) => {
      const actor = await actorFor(tx, ctx, payload.user.id);
      if (!actor) return null;
      if (payload.callback_id === "oi_pin") {
        const inc = await incidentForChannel(tx, ctx.tenantId, payload.channel.id);
        if (!inc) {
          void api.postEphemeral(
            payload.channel.id,
            payload.user.id,
            "This channel is not an incident channel.",
          );
          return null;
        }
        await pinMessage(
          tx,
          ctx,
          inc.id,
          actor,
          payload.channel.id,
          payload.message.ts,
          payload.message.text ?? "",
        );
        return null;
      }
      if (payload.callback_id === "oi_declare_from_message") {
        const opts = await declareOptions(tx, ctx.tenantId);
        if (!opts.type) return null;
        await api.openView(
          payload.trigger_id,
          declareModal({
            title: (payload.message.text ?? "").slice(0, 200),
            severities: opts.severities,
            services: opts.services,
            requireService: opts.requireService,
            privateMetadata: JSON.stringify({ channel: payload.channel.id }),
          }),
        );
        return null;
      }
      return null;
    });
  }
  return null;
}

/** A pinned Slack message becomes a pinned note on the timeline, with its permalink. */
async function pinMessage(
  tx: Tx,
  ctx: SlackContext,
  incidentId: string,
  actor: Actor,
  channelId: string,
  ts: string,
  text: string,
): Promise<void> {
  const api = slack(ctx.install.token);
  const body = text || (await api.history(channelId, ts))?.text || "";
  if (!body) return;
  const permalink = await api.permalink(channelId, ts);
  const now = new Date();
  await tx.insert(incidentEvents).values({
    tenantId: ctx.tenantId,
    incidentId,
    kind: "note",
    actorKind: "member",
    actorMemberId: actor.memberId,
    actorName: actor.name,
    pinned: true,
    payload: { system: "chat_pin", message: body.slice(0, 4000), permalink, channel: "slack" },
    occurredAt: now,
  });
  await tx.update(incidents).set({ lastActivityAt: now }).where(eq(incidents.id, incidentId));
}

type SlackEvent = {
  type: string;
  user?: string;
  reaction?: string;
  item?: { type: string; channel: string; ts: string };
  channel_id?: string;
  item_user?: string;
};

/** Events API: :pushpin: pins to the timeline, :white_check_mark: creates a follow-up. */
export async function handleEvent(ctx: SlackContext, event: SlackEvent): Promise<void> {
  if (event.type !== "reaction_added" && event.type !== "pin_added") return;
  const channelId = event.item?.channel ?? event.channel_id;
  const ts = event.item?.ts;
  if (!channelId || !ts || !event.user) return;
  const api = slack(ctx.install.token);
  const reaction = event.type === "pin_added" ? "pushpin" : (event.reaction ?? "");
  if (!["pushpin", "white_check_mark", "ballot_box_with_check"].includes(reaction)) return;
  const post: Post = [];
  await withTenant(ctx.tenantId, async (tx) => {
    const inc = await incidentForChannel(tx, ctx.tenantId, channelId);
    if (!inc) return;
    const actor = await actorFor(tx, ctx, event.user!);
    if (!actor) return;
    const msg = await api.history(channelId, ts);
    if (!msg?.text) return;
    if (reaction === "pushpin") {
      await pinMessage(tx, ctx, inc.id, actor, channelId, ts, msg.text);
      return;
    }
    const [dup] = await tx
      .select({ id: followUps.id })
      .from(followUps)
      .where(and(eq(followUps.incidentId, inc.id), eq(followUps.title, msg.text.slice(0, 300))));
    if (dup) return;
    const created = await addFollowUpCore(tx, ctx.tenantId, actor, inc.id, {
      title: msg.text.slice(0, 300),
      priorityName: "P2",
    });
    if (created)
      post.push(() =>
        afterIncidentChange(ctx.tenantId, inc.id, ["follow_up.created"], {
          follow_up: { id: created.id, title: msg.text.slice(0, 300) },
        }),
      );
  });
  for (const f of post)
    await f().catch((err) => console.error("[slack] post-commit work failed", err));
}

function safeJson(s: string | undefined): Record<string, unknown> {
  try {
    return s ? (JSON.parse(s) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
