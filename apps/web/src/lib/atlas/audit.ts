/**
 * The audit log's sentences for Atlas (actions `atlas.*`) — owner: atlas-core.
 * The Audit screen calls `atlasAuditSentence(row, t)` for any row whose action
 * starts with "atlas." and files it under the Atlas area. Lines Atlas wrote
 * itself carry actorName "Atlas" and no member.
 */
import type { Translate } from "@/i18n/server";
import { euros } from "./format";

type Row = { action: string; actorName: string; target: Record<string, unknown> };

const s = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "—");

export function isAtlasAudit(action: string): boolean {
  return action.startsWith("atlas.");
}

export function atlasAuditSentence(row: Row, t: Translate): string | null {
  const g = row.target ?? {};
  const actor = row.actorName;
  const grade = (v: unknown) =>
    typeof v === "string" && ["bullseye", "on_target", "miss", "nowhere_near"].includes(v)
      ? t(`atlas.grade.${v as "bullseye" | "on_target" | "miss" | "nowhere_near"}`)
      : s(v);
  const eur = (v: unknown) => (typeof v === "number" ? euros(t.fmt, v) : t("atlas.audit.noLimit"));
  switch (row.action) {
    case "atlas.acted":
      return g.paged
        ? t("atlas.audit.actedPaged", {
            action: s(g.action),
            member: s(g.paged),
            service: s(g.service),
            level: s(g.level),
            incident: s(g.incident),
          })
        : t("atlas.audit.acted", {
            action: s(g.action),
            service: s(g.service),
            level: s(g.level),
            incident: s(g.incident),
          });
    case "atlas.resolved":
      return g.alone
        ? t("atlas.audit.resolved", {
            incident: s(g.incident),
            until: typeof g.undoUntil === "string" ? t.fmt.dateTime(new Date(g.undoUntil)) : "—",
          })
        : t("atlas.audit.resolvedTold", {
            incident: s(g.incident),
            service: s(g.service),
            level: s(g.level),
          });
    case "atlas.proposed":
      return t("atlas.audit.proposed", {
        action: s(g.action),
        incident: s(g.incident),
        service: s(g.service),
        level: s(g.level),
      });
    case "atlas.failed":
      return t("atlas.audit.failed", {
        action: s(g.action),
        incident: s(g.incident),
        error: s(g.error),
      });
    case "atlas.level_changed": {
      const p = { service: s(g.service), from: s(g.from), to: s(g.to) };
      if (Number(g.to) > Number(g.from)) return t("atlas.audit.raised", p);
      if (g.cause === "grade" && g.grade)
        return t("atlas.audit.loweredGrade", { ...p, grade: grade(g.grade), by: s(g.by) });
      if (g.cause === "undo") return t("atlas.audit.loweredUndo", { ...p, by: s(g.by) });
      if (g.cause === "reopen") return t("atlas.audit.loweredReopen", p);
      return t("atlas.audit.lowered", p);
    }
    case "atlas.capped":
      return g.cap === null || g.cap === undefined
        ? t("atlas.audit.uncapped", { actor, service: s(g.service) })
        : t("atlas.audit.capped", { actor, service: s(g.service), cap: s(g.cap) });
    case "atlas.approved":
      return t("atlas.audit.approved", { actor, action: s(g.action), incident: s(g.incident) });
    case "atlas.rejected":
      return t("atlas.audit.rejected", { actor, action: s(g.action) });
    case "atlas.undone":
      return t("atlas.audit.undone", { actor, action: s(g.action) });
    case "atlas.redone":
      return t("atlas.audit.redone", { actor, action: s(g.action) });
    case "atlas.reviewed": {
      const v = g.verdict === "miss" ? "miss" : g.verdict === "reopen" ? "reopen" : "ok";
      return t(`atlas.audit.reviewed.${v}`, { actor, incident: s(g.incident) });
    }
    case "atlas.graded":
      return t("atlas.audit.graded", { actor, service: s(g.service), grade: grade(g.grade) });
    case "atlas.stopped":
      return t("atlas.audit.stopped", { actor, incident: s(g.incident) });
    case "atlas.resumed":
      return t("atlas.audit.resumed", { actor, incident: s(g.incident) });
    case "atlas.kill_switch_on":
      return t("atlas.audit.killOn", { actor });
    case "atlas.kill_switch_off":
      return t("atlas.audit.killOff", { actor });
    case "atlas.action_enabled":
      return t("atlas.audit.actionEnabled", { actor, action: s(g.action) });
    case "atlas.action_disabled":
      return t("atlas.audit.actionDisabled", { actor, action: s(g.action) });
    case "atlas.action_configured":
      return t("atlas.audit.actionConfigured", { actor, action: s(g.action) });
    case "atlas.guardrail_changed": {
      const key = s(g.guardrail);
      const label = [
        "sev1",
        "securityAndPrivate",
        "firstUseOnService",
        "changeFreeze",
        "publicStatusPage",
      ].includes(key)
        ? t(
            `atlas.set.limit.${key as "sev1" | "securityAndPrivate" | "firstUseOnService" | "changeFreeze" | "publicStatusPage"}`,
          )
        : key;
      return t(g.on ? "atlas.audit.guardrailOn" : "atlas.audit.guardrailOff", {
        actor,
        guardrail: label,
      });
    }
    case "atlas.budget_changed":
      return t("atlas.audit.budget", { actor, month: eur(g.month), perRun: eur(g.perRun) });
    case "atlas.secret_rotated":
      return t("atlas.audit.secretRotated", { actor });
    case "atlas.backtest_started":
      return t("atlas.audit.backtest", { actor, count: Number(g.incidents ?? 0) });
    default:
      return null;
  }
}
