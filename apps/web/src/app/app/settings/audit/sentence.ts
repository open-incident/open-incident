import type { MessageKey } from "@/i18n/dictionaries/en";
import type { MessageParams } from "@/i18n/dictionary";

/**
 * The audit log, written for a person to read: one sentence per line, built
 * from the stored action and its target — never a raw action name when the
 * product knows what it means.
 *
 * Most lines are the same gesture on a different object ("created the rule
 * “Production”", "paused the monitor “Checkout”"): those go through one
 * template per language, a verb and an object with its article, so French
 * and German keep their own word order. The rest have a sentence of their
 * own — a role changed from one to another, Atlas acting alone at a level.
 *
 * The values interpolated are data (names typed by members, text written by
 * Atlas): rendered as text, never as markup.
 */

export type Area =
  "workspace" | "access" | "incidents" | "oncall" | "services" | "alerts" | "platform" | "atlas";

/** The filter chips, in the order they are shown. */
export const AREAS: Area[] = [
  "workspace",
  "access",
  "incidents",
  "oncall",
  "services",
  "alerts",
  "platform",
  "atlas",
];

/** The design's chips — always shown, even at zero; the others appear with their first line. */
export const CORE_AREAS: Area[] = ["workspace", "access", "alerts", "platform", "atlas"];

const PREFIX_AREA: Array<[string, Area]> = [
  ["workspace.post_mortem_settings", "incidents"],
  ["workspace.", "workspace"],
  ["working_hours.", "workspace"],
  ["slack.member_linked", "access"],
  ["teams.member_linked", "access"],
  ["member.", "access"],
  ["role.", "access"],
  ["sso.", "access"],
  ["scim.", "access"],
  ["session.", "access"],
  ["team.provisioned", "access"],
  ["team.updated_by_provider", "access"],
  ["team.deleted_by_provider", "access"],
  ["incident_type.", "incidents"],
  ["incident_status.", "incidents"],
  ["incident_field.", "incidents"],
  ["severity.", "incidents"],
  ["announcement_", "incidents"],
  ["post_incident_task.", "incidents"],
  ["status_page.", "incidents"],
  ["status_component.", "incidents"],
  ["status_template.", "incidents"],
  ["status_subscribers.", "incidents"],
  ["maintenance.", "incidents"],
  ["incident.", "incidents"],
  ["escalation_path.", "oncall"],
  ["schedule.", "oncall"],
  ["rotation.", "oncall"],
  ["override.", "oncall"],
  ["cover.", "oncall"],
  ["team.", "oncall"],
  ["oncall.", "oncall"],
  ["alerting.", "oncall"],
  ["pay.", "oncall"],
  ["service.", "services"],
  ["runbook.", "services"],
  ["alert_", "alerts"],
  ["monitor.", "alerts"],
  ["heartbeat.", "alerts"],
  ["slo.", "alerts"],
  ["atlas.", "atlas"],
  ["ai.", "atlas"],
];

export function areaOf(action: string, category: string): Area {
  for (const [p, a] of PREFIX_AREA) if (action.startsWith(p)) return a;
  if (category === "members" || action.startsWith("security.")) return "access";
  return "platform";
}

type Target = Record<string, unknown>;
type Built = [MessageKey, MessageParams];
type T = (key: MessageKey, params?: MessageParams) => string;

const str = (v: unknown, fallback = "—"): string =>
  typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : fallback;

const ref = (n: unknown) => (typeof n === "number" || typeof n === "string" ? `INC-${n}` : "");

/** Same gesture, another object: [verb, object, the target field naming it]. */
const CRUD: Record<string, [string, string, string?]> = {
  "working_hours.created": ["created", "hours", "name"],
  "working_hours.updated": ["changed", "hours", "name"],
  "working_hours.deleted": ["deleted", "hours", "name"],
  "role.created": ["created", "role", "name"],
  "role.updated": ["changed", "role", "name"],
  "role.deleted": ["deleted", "role"],
  "incident_type.created": ["created", "type", "name"],
  "incident_type.deleted": ["deleted", "type", "name"],
  "incident_type.updated": ["changed", "type", "to"],
  "incident_status.created": ["added", "status", "name"],
  "incident_status.deleted": ["deleted", "status", "name"],
  "incident_status.moved": ["moved", "status", "name"],
  "incident_field.created": ["added", "field", "key"],
  "incident_field.deleted": ["deleted", "field", "key"],
  "announcement_rule.created": ["created", "annRule", "name"],
  "announcement_rule.deleted": ["deleted", "annRule", "name"],
  "announcement_rule.enabled": ["switchedOn", "annRule", "name"],
  "announcement_rule.disabled": ["switchedOff", "annRule", "name"],
  "announcement_template.created": ["created", "annTemplate", "name"],
  "announcement_template.updated": ["changed", "annTemplate", "name"],
  "announcement_template.deleted": ["deleted", "annTemplate", "name"],
  "post_incident_task.created": ["added", "task", "title"],
  "post_incident_task.deleted": ["removed", "task", "title"],
  "status_page.created": ["created", "statusPage", "name"],
  "status_page.updated": ["changed", "statusPage", "name"],
  "status_page.deleted": ["deleted", "statusPage", "name"],
  "status_component.created": ["added", "component", "name"],
  "status_component.updated": ["changed", "component", "name"],
  "status_component.deleted": ["deleted", "component", "name"],
  "status_template.saved": ["saved", "statusTemplate", "name"],
  "maintenance.scheduled": ["scheduled", "maintenance", "title"],
  "maintenance.edited": ["changed", "maintenance", "title"],
  "maintenance.cancelled": ["cancelled", "maintenance", "title"],
  "escalation_path.created": ["created", "path", "name"],
  "schedule.created": ["created", "schedule", "name"],
  "schedule.published": ["published", "schedule", "name"],
  "team.created": ["created", "team", "name"],
  "team.updated": ["changed", "team", "name"],
  "team.deleted": ["deleted", "team", "name"],
  "team.provisioned": ["created", "team", "name"],
  "team.updated_by_provider": ["changed", "team", "name"],
  "team.deleted_by_provider": ["deleted", "team", "name"],
  "service.declared": ["declared", "service", "service"],
  "service.deleted": ["deleted", "service", "service"],
  "runbook.created": ["added", "runbook", "title"],
  "runbook.deleted": ["removed", "runbook", "title"],
  "alert_route.created": ["created", "rule", "name"],
  "alert_route.updated": ["changed", "rule", "name"],
  "alert_route.deleted": ["deleted", "rule", "name"],
  "alert_route.toggled": ["switched", "rule", "name"],
  "alert_route.moved": ["moved", "rule", "name"],
  "alert_priority.created": ["added", "alertSeverity", "name"],
  "alert_priority.updated": ["changed", "alertSeverity", "name"],
  "alert_priority.deleted": ["deleted", "alertSeverity", "name"],
  "alert_attribute.created": ["added", "label", "key"],
  "alert_attribute.updated": ["changed", "label", "key"],
  "alert_attribute.deleted": ["deleted", "label", "key"],
  "alert_source.created": ["connected", "source", "name"],
  "alert_source.deleted": ["deleted", "source", "name"],
  "alert_source.enabled": ["switchedOn", "source", "name"],
  "alert_source.disabled": ["switchedOff", "source", "name"],
  "alert_source.secret_rotated": ["rotatedSecret", "source", "name"],
  "alert_source.test_on": ["testOn", "source", "name"],
  "alert_source.test_off": ["testOff", "source", "name"],
  "alert_source.choices": ["changed", "source", "name"],
  "monitor.created": ["created", "monitor", "name"],
  "monitor.updated": ["changed", "monitor", "name"],
  "monitor.deleted": ["deleted", "monitor", "name"],
  "monitor.paused": ["paused", "monitor", "name"],
  "monitor.resumed": ["resumed", "monitor", "name"],
  "monitor.criteria.saved": ["changed", "monitor", "name"],
  "monitor.journey.saved": ["changed", "monitor", "name"],
  "monitor.secret.set": ["changed", "monitor", "name"],
  "monitor.secret.removed": ["changed", "monitor"],
  "heartbeat.created": ["created", "heartbeat", "name"],
  "heartbeat.deleted": ["deleted", "heartbeat", "name"],
  "heartbeat.paused": ["paused", "heartbeat", "name"],
  "heartbeat.resumed": ["resumed", "heartbeat", "name"],
  "heartbeat.token_rotated": ["rotatedSecret", "heartbeat", "name"],
  "slo.created": ["created", "slo", "name"],
  "slo.deleted": ["deleted", "slo", "name"],
  "slo.paused": ["paused", "slo", "name"],
  "slo.resumed": ["resumed", "slo", "name"],
  "api_key.revoked": ["revoked", "apiKey", "name"],
  "webhook.created": ["added", "endpoint", "url"],
  "webhook.deleted": ["deleted", "endpoint", "url"],
  "webhook.enabled": ["switchedOn", "endpoint", "url"],
  "webhook.disabled": ["switchedOff", "endpoint", "url"],
  "rum.application.created": ["added", "rumApp", "name"],
  "rum.application.changed": ["changed", "rumApp", "name"],
  "rum.application.deleted": ["deleted", "rumApp", "name"],
};

const TOOL_NAMES: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  jira: "Jira",
  linear: "Linear",
  confluence: "Confluence",
  notion: "Notion",
  meet: "Google Meet",
  zoom: "Zoom",
  slack: "Slack",
  teams: "Microsoft Teams",
};

const SUITES = ["smoke", "unit", "typecheck", "lint", "format"];

function role(t: T, v: unknown): string {
  const s = str(v);
  if (s === "owner" || s === "admin" || s === "responder" || s === "viewer")
    return t(`member.role.${s}`);
  if (s.startsWith("custom:")) return t("settingsV2.audit.customRole");
  return s;
}

/** Atlas's own lines: what it did, alone or with someone paged, and at what level. */
function atlas(t: T, action: string, g: Target, actor: string): Built | null {
  const inc = ref(g.incident);
  const service = str(g.service, "");
  const level = str(g.level, "");
  switch (action) {
    case "atlas.acted":
      return g.paged
        ? [
            "settingsV2.audit.s.atlasActedPaged",
            { action: str(g.action), paged: str(g.paged), service, level, inc },
          ]
        : ["settingsV2.audit.s.atlasActedAlone", { action: str(g.action), service, level, inc }];
    case "atlas.proposed":
      return ["settingsV2.audit.s.atlasProposed", { action: str(g.action), service, level, inc }];
    case "atlas.failed":
      return [
        "settingsV2.audit.s.atlasFailed",
        { action: str(g.action), error: str(g.error), inc },
      ];
    case "atlas.resolved": {
      if (!g.alone) return ["settingsV2.audit.s.atlasResolved", { inc, service, level }];
      const until = typeof g.undoUntil === "string" ? new Date(g.undoUntil) : null;
      return [
        "settingsV2.audit.s.atlasResolvedAlone",
        { inc, until: until && !Number.isNaN(until.getTime()) ? until.toISOString() : "" },
      ];
    }
    case "atlas.level_changed": {
      const from = Number(g.from ?? 0);
      const to = Number(g.to ?? 0);
      const key = to >= from ? "settingsV2.audit.s.atlasRaised" : "settingsV2.audit.s.atlasLowered";
      let why = "";
      if (g.cause === "grade" && g.by)
        why = t("settingsV2.audit.s.whyGrade", {
          grade:
            g.grade === "miss" ? t("settingsV2.audit.gradeMiss") : t("settingsV2.audit.gradeOk"),
          by: str(g.by),
        });
      else if (g.cause === "undo" && g.by) why = t("settingsV2.audit.s.whyUndo", { by: str(g.by) });
      else if (g.cause === "promotion") why = t("settingsV2.audit.s.whyPromotion");
      return [key, { service, from, to, why }];
    }
    case "atlas.capped":
      return g.cap === null || g.cap === undefined
        ? ["settingsV2.audit.s.atlasUncapped", { actor, service }]
        : ["settingsV2.audit.s.atlasCapped", { actor, service, cap: str(g.cap) }];
    case "atlas.approved":
      return ["settingsV2.audit.s.atlasApproved", { actor, action: str(g.action), inc }];
    case "atlas.rejected":
      return ["settingsV2.audit.s.atlasRejected", { actor, action: str(g.action) }];
    case "atlas.undone":
      return ["settingsV2.audit.s.atlasUndone", { actor, action: str(g.action) }];
    case "atlas.redone":
      return ["settingsV2.audit.s.atlasRedone", { actor, action: str(g.action) }];
    case "atlas.reviewed":
      return g.verdict === "reopen"
        ? ["settingsV2.audit.s.atlasReopened", { actor, inc }]
        : [
            "settingsV2.audit.s.atlasReviewed",
            {
              actor,
              inc,
              grade:
                g.verdict === "miss"
                  ? t("settingsV2.audit.gradeMiss")
                  : t("settingsV2.audit.gradeOk"),
            },
          ];
    case "atlas.graded":
      return [
        "settingsV2.audit.s.atlasGraded",
        {
          actor,
          service,
          grade:
            g.grade === "miss" ? t("settingsV2.audit.gradeMiss") : t("settingsV2.audit.gradeOk"),
        },
      ];
    case "atlas.stopped":
      return ["settingsV2.audit.s.atlasStopped", { actor, inc }];
    case "atlas.resumed":
      return ["settingsV2.audit.s.atlasResumed", { actor, inc }];
    case "atlas.kill_switch_on":
      return ["settingsV2.audit.s.atlasKillOn", { actor }];
    case "atlas.kill_switch_off":
      return ["settingsV2.audit.s.atlasKillOff", { actor }];
    case "atlas.action_enabled":
      return ["settingsV2.audit.s.atlasAllowed", { actor, action: str(g.action) }];
    case "atlas.action_disabled":
      return ["settingsV2.audit.s.atlasDisallowed", { actor, action: str(g.action) }];
    case "atlas.action_configured":
      return ["settingsV2.audit.s.atlasConfigured", { actor, action: str(g.action) }];
    case "atlas.guardrail_changed":
      return [
        g.on ? "settingsV2.audit.s.atlasGuardOn" : "settingsV2.audit.s.atlasGuardOff",
        { actor, guardrail: str(g.guardrail) },
      ];
    case "atlas.budget_changed":
      return [
        "settingsV2.audit.s.atlasBudget",
        { actor, month: str(g.month), perRun: str(g.perRun) },
      ];
    case "atlas.secret_rotated":
      return ["settingsV2.audit.s.atlasSecret", { actor }];
    case "atlas.backtest_started":
      return ["settingsV2.audit.s.atlasBacktest", { actor }];
    case "ai.settings":
      return ["settingsV2.audit.s.aiSettings", { actor }];
  }
  return null;
}

/**
 * The sentence of one audit line. `when` formats an ISO instant in the
 * reader's language and zone (Atlas's undo deadline).
 */
export function auditSentence(
  t: T,
  row: { action: string; target: Target; actorName: string },
  when: (iso: string) => string,
): string {
  const g = row.target ?? {};
  const actor = row.actorName;
  const action = row.action;

  const crud = CRUD[action];
  if (crud) {
    const [verb, thing, field] = crud;
    const name = field ? str(g[field], "") : "";
    const params = {
      actor,
      verb: t(`settingsV2.audit.v.${verb}` as MessageKey),
      thing: t(`settingsV2.audit.thing.${thing}` as MessageKey),
      name,
    };
    return name ? t("settingsV2.audit.tpl.named", params) : t("settingsV2.audit.tpl.plain", params);
  }

  const a = atlas(t, action, g, actor);
  if (a) {
    const [key, params] = a;
    if (key === "settingsV2.audit.s.atlasResolvedAlone")
      return params.until
        ? t(key, { ...params, until: when(String(params.until)) })
        : t("settingsV2.audit.s.atlasResolvedAloneNoUndo", params);
    return t(key, params);
  }

  const tool = (k: unknown) => TOOL_NAMES[str(k, "")] ?? str(k);
  const built = ((): Built | null => {
    switch (action) {
      case "workspace.updated": {
        if (g.timezone)
          return ["settingsV2.audit.s.timezone", { actor, timezone: str(g.timezone) }];
        if (g.name) return ["settingsV2.audit.s.renamed", { actor, name: str(g.name) }];
        if (g.locale) return ["settingsV2.audit.s.language", { actor, language: str(g.locale) }];
        if (g.accentColor || g.accent)
          return ["settingsV2.audit.s.accent", { actor, accent: str(g.accentColor ?? g.accent) }];
        return ["settingsV2.audit.s.workspace", { actor }];
      }
      case "workspace.logo":
        return ["settingsV2.audit.s.logo", { actor }];
      case "workspace.post_mortem_settings":
        return ["settingsV2.audit.s.postMortem", { actor }];
      case "member.invited":
        return [
          "settingsV2.audit.s.invited",
          { actor, email: str(g.email), role: role(t, g.role) },
        ];
      case "member.role_changed":
        return [
          "settingsV2.audit.s.roleChanged",
          { actor, member: str(g.member), from: role(t, g.from), to: role(t, g.to) },
        ];
      case "member.disabled":
        return ["settingsV2.audit.s.disabled", { actor, member: str(g.member ?? g.email) }];
      case "member.reactivated":
        return ["settingsV2.audit.s.reactivated", { actor, member: str(g.member ?? g.email) }];
      case "member.invite_revoked":
        return ["settingsV2.audit.s.inviteRevoked", { actor, email: str(g.email) }];
      case "member.provisioned":
        return [
          "settingsV2.audit.s.provisioned",
          { actor, email: str(g.email), role: role(t, g.role) },
        ];
      case "member.updated_by_provider":
        return [
          "settingsV2.audit.s.provUpdated",
          { actor, email: str(g.email ?? g.member ?? g.name) },
        ];
      case "member.deactivated_by_provider":
        return ["settingsV2.audit.s.provDeactivated", { actor, email: str(g.email ?? g.member) }];
      case "sso.connection_created":
        return [
          g.enforce ? "settingsV2.audit.s.ssoAddedOnly" : "settingsV2.audit.s.ssoAdded",
          { actor, label: str(g.label) },
        ];
      case "sso.connection_removed":
        return ["settingsV2.audit.s.ssoRemoved", { actor }];
      case "scim.enabled":
        return ["settingsV2.audit.s.scimOn", { actor }];
      case "scim.disabled":
        return ["settingsV2.audit.s.scimOff", { actor }];
      case "scim.token_rotated":
        return ["settingsV2.audit.s.scimToken", { actor }];
      case "session.sso_signed_in":
        return [
          g.created ? "settingsV2.audit.s.ssoFirstSignIn" : "settingsV2.audit.s.ssoSignIn",
          { email: str(g.email, actor), provider: str(g.provider) },
        ];
      case "slack.member_linked":
      case "teams.member_linked":
        return [
          "settingsV2.audit.s.linked",
          { actor, member: str(g.member), tool: tool(action.split(".")[0]) },
        ];
      case "incident_status.updated":
        return ["settingsV2.audit.s.statusRenamed", { actor, from: str(g.from), to: str(g.to) }];
      case "severity.updated":
        return g.from && g.from !== g.to
          ? ["settingsV2.audit.s.sevRenamed", { actor, from: str(g.from), to: str(g.to) }]
          : ["settingsV2.audit.s.sevChanged", { actor, name: str(g.to) }];
      case "status_page.domain":
        return ["settingsV2.audit.s.domain", { actor, domain: str(g.domain) }];
      case "status_page.update_corrected":
        return ["settingsV2.audit.s.corrected", { actor }];
      case "status_page.subscribers_imported":
      case "status_subscribers.imported":
        return ["settingsV2.audit.s.subscribers", { actor, count: Number(g.count ?? 0) }];
      case "status_component.state":
        return [
          "settingsV2.audit.s.componentState",
          { actor, name: str(g.name), state: str(g.state) },
        ];
      case "escalation_path.published":
        return [
          "settingsV2.audit.s.pathPublished",
          { actor, name: str(g.name), version: str(g.version) },
        ];
      case "rotation.members_changed":
        return ["settingsV2.audit.s.rotation", { actor, name: str(g.rotation) }];
      case "override.created":
        return ["settingsV2.audit.s.overrideAdded", { actor }];
      case "override.deleted":
        return ["settingsV2.audit.s.overrideRemoved", { actor }];
      case "cover.requested":
        return ["settingsV2.audit.s.coverAsked", { actor, name: str(g.schedule) }];
      case "cover.accepted":
        return ["settingsV2.audit.s.coverAccepted", { actor }];
      case "team.members_changed":
        return ["settingsV2.audit.s.teamMembers", { actor, name: str(g.team) }];
      case "team.policy_set":
        return [
          "settingsV2.audit.s.teamPolicy",
          { actor, team: str(g.team), policy: str(g.policy) },
        ];
      case "oncall.paged":
        return ["settingsV2.audit.s.paged", { actor, name: str(g.name) }];
      case "alerting.page_me":
        return ["settingsV2.audit.s.pageMe", { actor }];
      case "pay.rules_saved":
        return ["settingsV2.audit.s.payRules", { actor }];
      case "pay.report_generated":
        return ["settingsV2.audit.s.payReport", { actor, period: str(g.period) }];
      case "pay.report_published":
        return ["settingsV2.audit.s.payPublished", { actor, period: str(g.period) }];
      case "service.merged":
        return [
          "settingsV2.audit.s.serviceMerged",
          { actor, merged: str(g.merged), service: str(g.service) },
        ];
      case "service.owner_set":
        return [
          "settingsV2.audit.s.ownerSet",
          { actor, team: str(g.team), service: str(g.service) },
        ];
      case "service.owner_cleared":
        return ["settingsV2.audit.s.ownerCleared", { actor, service: str(g.service) }];
      case "service.label_set":
        return [
          "settingsV2.audit.s.labelSet",
          { actor, label: str(g.label), service: str(g.service) },
        ];
      case "service.label_removed":
        return [
          "settingsV2.audit.s.labelRemoved",
          { actor, label: str(g.label), service: str(g.service) },
        ];
      case "alert_route.duplicated":
        return [
          "settingsV2.audit.s.ruleDuplicated",
          { actor, from: str(g.from), name: str(g.name) },
        ];
      case "alert_source.mappings":
        return ["settingsV2.audit.s.mappings", { actor, count: Number(g.count ?? 0) }];
      case "api_key.created": {
        const scopes = Array.isArray(g.scopes) ? (g.scopes as string[]) : [];
        const access = scopes.includes("write")
          ? t("settingsV2.audit.readWrite")
          : scopes.includes("read")
            ? t("settingsV2.audit.read")
            : t("settingsV2.audit.declare");
        const resources = Array.isArray(g.resources)
          ? (g.resources as string[])
              .map((r) => r.replace("_", " "))
              .join(t("settingsV2.audit.and"))
          : t("settingsV2.audit.everything");
        return [
          "settingsV2.audit.s.keyCreated",
          { actor, name: str(g.name ?? g.hint), access, resources },
        ];
      }
      case "webhook.tested":
        return [
          "settingsV2.audit.s.hookTested",
          {
            actor,
            url: str(g.url),
            status: g.status === null ? t("settingsV2.api.noAnswer") : str(g.status),
          },
        ];
      case "slack.configured":
      case "teams.configured":
        return ["settingsV2.audit.s.chatConfigured", { actor, tool: tool(action.split(".")[0]) }];
      case "slack.disconnected":
      case "teams.disconnected":
        return [
          "settingsV2.audit.s.chatDisconnected",
          { actor, tool: tool(action.split(".")[0]), team: str(g.team) },
        ];
      case "slack.connected":
      case "slack.installed":
      case "teams.connected":
      case "teams.paired":
        return [
          "settingsV2.audit.s.chatConnected",
          { actor, tool: tool(action.split(".")[0]), team: str(g.team ?? g.teamName) },
        ];
      case "teams.pairing_started":
        return ["settingsV2.audit.s.teamsPairing", { actor }];
      case "bridge.configured":
        return [
          "settingsV2.audit.s.bridgeSet",
          { actor, tool: tool(g.kind), template: str(g.template) },
        ];
      case "bridge.removed":
        return ["settingsV2.audit.s.bridgeRemoved", { actor, tool: tool(g.kind) }];
      case "tracker.connected":
      case "docs.connected":
        return [
          "settingsV2.audit.s.toolConnected",
          { actor, tool: tool(g.kind), target: str(g.target) },
        ];
      case "tracker.disconnected":
      case "docs.disconnected":
        return ["settingsV2.audit.s.toolDisconnected", { actor, tool: tool(g.kind) }];
      case "telemetry.settings.saved":
        return [
          "settingsV2.audit.s.telemetry",
          {
            actor,
            traces: str(g.retentionTracesDays),
            logs: str(g.retentionLogsDays),
          },
        ];
      case "qa.run_queued":
        return [
          "settingsV2.audit.s.qaQueued",
          {
            actor,
            suite: SUITES.includes(str(g.suite, ""))
              ? t(`settingsV2.qa.suite.${str(g.suite)}` as MessageKey)
              : str(g.suite),
          },
        ];
      case "qa.run_cancelled":
        return ["settingsV2.audit.s.qaCancelled", { actor }];
      case "audit.exported":
        return ["settingsV2.audit.s.exported", { actor, count: Number(g.rows ?? 0) }];
    }
    if (action.startsWith("service.dependency_"))
      return [
        "settingsV2.audit.s.dependency",
        { actor, service: str(g.service), other: str(g.other) },
      ];
    return null;
  })();
  if (built) return t(built[0], built[1]);
  return t("settingsV2.audit.s.unknown", { actor, action });
}
