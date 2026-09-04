/**
 * From a stored event to what the timeline draws. Events carry structured
 * payloads; the words come from the dictionaries, so the same timeline reads
 * in every language.
 */
import type { incidentEvents } from "@openincident/db";
import type { Translate } from "@/i18n/server";

type Ev = typeof incidentEvents.$inferSelect;
type T = Pick<Translate, "fmt"> &
  ((key: Parameters<Translate>[0], params?: Parameters<Translate>[1]) => string);

export type TimelineItem = {
  id: string;
  at: Date;
  dot: string;
  title: string;
  description: string;
  card: boolean;
  pinned: boolean;
  tag?: { label: string; bg: string; ink: string };
  bg?: string;
  border?: string;
  isUpdate: boolean;
  /** An external link the item opens (a pinned Slack message). */
  href?: string;
};

const s = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;

export function renderEvent(ev: Ev, t: T): TimelineItem {
  const p = ev.payload ?? {};
  const actor = ev.actorName ?? t("timeline.system");
  const base = { id: ev.id, at: ev.occurredAt, pinned: ev.pinned, card: false, isUpdate: false };
  const sourceTag = (label: string) => ({ label, bg: "var(--sunk)", ink: "var(--ink-2)" });

  switch (ev.kind) {
    case "declared":
      return {
        ...base,
        dot: "var(--brand)",
        title: t("timeline.declared", { actor }),
        description: [
          t(`timeline.source.${s(p.source, "web") as "web" | "api" | "alert"}`),
          s(p.severity),
          s(p.service),
          s(p.mode) === "retrospective" ? t("timeline.retrospective") : "",
          s(p.note),
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "created_from_alert":
      return {
        ...base,
        dot: "var(--wait)",
        card: true,
        tag: sourceTag(s(p.source, "—")),
        title: t("timeline.alertAttached", { source: s(p.source, "—") }),
        description: `${s(p.title)}${p.grouped ? ` · ${t("timeline.grouped", { count: Number(p.grouped) })}` : ""} · ${t("timeline.createdInTriage")}`,
      };
    case "alert_attached":
      return {
        ...base,
        dot: "var(--wait)",
        card: true,
        tag: sourceTag(s(p.source, "—")),
        title: t("timeline.alertAttached", { source: s(p.source, "—") }),
        description: s(p.title),
      };
    case "escalation_triggered":
      return {
        ...base,
        dot: "var(--dang)",
        title: t("timeline.escalationTriggered", { path: s(p.path, "—") }),
        description: [
          t("timeline.level", { level: Number(p.level ?? 1) }),
          p.urgency === "high" ? t("timeline.urgencyHigh") : t("timeline.urgencyLow"),
          Array.isArray(p.channels)
            ? (p.channels as string[])
                .map((c) => t(`timeline.channel.${c as "voice" | "sms" | "webpush" | "email"}`))
                .join(", ")
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "escalation_acknowledged":
      return {
        ...base,
        dot: "var(--ok)",
        title: t("timeline.acknowledged", { actor }),
        description: [
          t(`timeline.channel.${s(p.channel, "webpush") as "voice" | "sms" | "webpush" | "email"}`),
          p.afterMinutes !== undefined
            ? t("timeline.afterPage", { count: Number(p.afterMinutes) })
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "accepted":
      return {
        ...base,
        dot: "var(--brand)",
        title: t("timeline.accepted", { actor }),
        description: t("timeline.acceptedDesc", {
          severity: s(p.severity, "—"),
          status: s(p.status, "—"),
        }),
      };
    case "declined":
      return {
        ...base,
        dot: "var(--ink-3)",
        title: t("timeline.declined", { actor }),
        description: s(p.reason),
      };
    case "role_assigned":
      return {
        ...base,
        dot: "var(--brand)",
        title: t("timeline.roleAssigned", {
          member: s(p.member, actor),
          role: p.role === "lead" ? t("incident.roleLead") : s(p.roleName, s(p.role)),
        }),
        description:
          p.reason === "on_call_for_service"
            ? t("timeline.autoOnCall", { service: s(p.service) })
            : ev.actorKind === "member"
              ? t("timeline.byActor", { actor })
              : "",
      };
    case "role_unassigned":
      return {
        ...base,
        dot: "var(--ink-3)",
        title: t("timeline.roleUnassigned", { member: s(p.member), role: s(p.roleName) }),
        description: t("timeline.byActor", { actor }),
      };
    case "update_posted":
      return {
        ...base,
        dot: "var(--open)",
        card: true,
        isUpdate: true,
        tag: { label: t("timeline.updateTag"), bg: "var(--open-t)", ink: "var(--open)" },
        title: t("timeline.update", { status: s(p.status, "—") }),
        description: `« ${s(p.message)} »${p.nextUpdateMinutes ? ` · ${t("timeline.nextUpdateIn", { count: Number(p.nextUpdateMinutes) })}` : ""}${p.severity ? ` · ${t("timeline.severitySet", { severity: s(p.severity) })}` : ""}`,
      };
    case "status_changed":
      return {
        ...base,
        dot: "var(--open)",
        title: t("timeline.statusChanged", { status: s(p.to, "—") }),
        description: t("timeline.byActor", { actor }),
      };
    case "severity_changed":
      return {
        ...base,
        dot: "var(--wait)",
        title: t("timeline.severityChanged", { from: s(p.from, "—"), to: s(p.to, "—") }),
        description: t("timeline.byActor", { actor }),
      };
    case "note":
      if (p.system === "chat_pin") {
        return {
          ...base,
          dot: "var(--brand)",
          card: true,
          tag: sourceTag("Slack"),
          title: t("timeline.chatPinned", { actor }),
          description: s(p.message),
          href: typeof p.permalink === "string" ? p.permalink : undefined,
        };
      }
      if (p.system === "status_page_published") {
        return {
          ...base,
          dot: "var(--brand)",
          title: t(p.created ? "timeline.statusPagePublished" : "timeline.statusPageUpdated", {
            page: s(p.page),
            status: s(p.status),
          }),
          description: t("timeline.byActor", { actor }),
        };
      }
      if (p.system === "alert_resolved") {
        return {
          ...base,
          dot: "var(--ok)",
          title: t("timeline.alertResolved"),
          description: s(p.title),
        };
      }
      if (p.system === "escalation_exhausted") {
        return {
          ...base,
          dot: "var(--dang)",
          title: t("timeline.escalationExhausted"),
          description: "",
        };
      }
      if (p.system === "update_overdue") {
        return {
          ...base,
          dot: "var(--wait)",
          title: t("timeline.updateOverdue"),
          description: p.lead ? t("timeline.updateOverdueDesc", { lead: s(p.lead) }) : "",
        };
      }
      return {
        ...base,
        dot: "var(--wait)",
        card: true,
        bg: "var(--note)",
        border: "var(--note-b)",
        title: t("timeline.note", { actor }),
        description: s(p.message),
      };
    case "link_added":
      return {
        ...base,
        dot: "var(--ink-3)",
        card: true,
        tag: sourceTag(
          p.provider === "github"
            ? "GitHub"
            : p.provider === "jira"
              ? "Jira"
              : p.provider === "linear"
                ? "Linear"
                : s(p.provider, "—"),
        ),
        title: p.kind === "pull_request" ? t("timeline.pullRequest") : t("timeline.link"),
        description: `${s(p.ref)} — ${s(p.title)}`,
      };
    case "deployment":
      return {
        ...base,
        dot: "var(--ink-3)",
        card: true,
        tag: sourceTag(p.provider === "github" ? "GitHub" : s(p.provider, "—")),
        title: t("timeline.deployment"),
        description: `${s(p.service)} ${s(p.version)} ${s(p.note)}`.trim(),
      };
    case "action_created":
      return {
        ...base,
        dot: "var(--brand)",
        title: t("timeline.actionCreated", { actor }),
        description: s(p.title),
      };
    case "action_completed":
      return {
        ...base,
        dot: "var(--ok)",
        title: t("timeline.actionCompleted", { actor }),
        description: s(p.title),
      };
    case "follow_up_created":
      return {
        ...base,
        dot: "var(--brand)",
        title: t("timeline.followUpCreated", { actor }),
        description: `${s(p.title)}${p.priority ? ` · ${s(p.priority)}` : ""}`,
      };
    case "follow_up_completed":
      return {
        ...base,
        dot: "var(--ok)",
        title: t("timeline.followUpCompleted", { actor }),
        description: s(p.title),
      };
    case "resolved":
      return {
        ...base,
        dot: "var(--ok)",
        title: t("timeline.resolved", { actor }),
        description: [
          p.durationMinutes !== undefined
            ? t("timeline.duration", { duration: t.fmt.duration(Number(p.durationMinutes)) })
            : "",
          p.ttaMinutes !== undefined ? t("timeline.tta", { count: Number(p.ttaMinutes) }) : "",
          p.postIncident ? t("timeline.postIncidentStarts", { rule: s(p.postIncident) }) : "",
          s(p.note),
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "reopened":
      return {
        ...base,
        dot: "var(--wait)",
        title: t("timeline.reopened", { actor }),
        description: s(p.reason),
      };
    case "closed":
      return {
        ...base,
        dot: "var(--ink-3)",
        title: t("timeline.closed", { actor }),
        description: s(p.reason),
      };
    case "post_incident_started":
      return {
        ...base,
        dot: "var(--brand)",
        title: t("timeline.postIncidentStarted"),
        description: s(p.rule),
      };
    case "task_completed":
      return {
        ...base,
        dot: "var(--ok)",
        title: t("timeline.taskCompleted", { actor }),
        description: s(p.title),
      };
    case "task_skipped":
      return {
        ...base,
        dot: "var(--wait)",
        title: t("timeline.taskSkipped", { actor }),
        description: `${s(p.title)} — ${s(p.reason)}`,
      };
    case "post_mortem_published":
      return {
        ...base,
        dot: "var(--viol)",
        title: t("timeline.postMortemPublished"),
        description: [
          t("timeline.postMortemStatus.in_review"),
          p.followUps !== undefined
            ? t("timeline.followUpsCreated", { count: Number(p.followUps) })
            : "",
          p.debriefAt
            ? t("timeline.debriefScheduled", {
                date: t.fmt.dateShort(new Date(String(p.debriefAt))),
              })
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "custom_field_changed":
      return {
        ...base,
        dot: "var(--ink-3)",
        title: t("timeline.fieldChanged", { field: s(p.field) }),
        description: `${s(p.from, "—")} → ${s(p.to, "—")} · ${t("timeline.byActor", { actor })}`,
      };
    case "visibility_changed":
      return {
        ...base,
        dot: "var(--viol)",
        title: p.to === "private" ? t("timeline.madePrivate") : t("timeline.madePublic"),
        description: t("timeline.byActor", { actor }),
      };
    case "renamed":
      return {
        ...base,
        dot: "var(--ink-3)",
        title: t("timeline.renamed", { actor }),
        description: `${s(p.from)} → ${s(p.to)}`,
      };
    case "merged":
      return {
        ...base,
        dot: "var(--ink-3)",
        title: t("timeline.merged", { target: s(p.into) }),
        description: t("timeline.byActor", { actor }),
      };
    default:
      return { ...base, dot: "var(--ink-3)", title: ev.kind, description: "" };
  }
}
