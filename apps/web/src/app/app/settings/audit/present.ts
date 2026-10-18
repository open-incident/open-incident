import type { MessageKey } from "@/i18n/dictionaries/en";
import type { MessageParams } from "@/i18n/dictionary";
import type { LocaleFormat } from "@/i18n/format";
import { initials } from "@/i18n/format";
import type { AuditRow } from "./data";
import type { Translate } from "@/i18n/server";
import { atlasAuditSentence, isAtlasAudit } from "@/lib/atlas/audit";
import { areaOf, auditSentence, type Area } from "./sentence";

type T = ((key: MessageKey, params?: MessageParams) => string) & {
  fmt: LocaleFormat;
  timeZone: string;
};

const MEMBER_TONES = [
  { bg: "var(--brand-t)", ink: "var(--brand)" },
  { bg: "var(--open-t)", ink: "var(--open)" },
  { bg: "var(--wait-t)", ink: "var(--wait)" },
  { bg: "var(--ok-t)", ink: "var(--ok)" },
];

/**
 * Who wrote the line, as the 30 px square of the row: Atlas is ✦ on violet,
 * a member their initials on a colour of their own (the same every time),
 * a system — provisioning, an uninstalled app, an API key — its initials on
 * grey.
 */
export function actorGlyph(row: Pick<AuditRow, "actorName" | "actorMemberId">): {
  text: string;
  bg: string;
  ink: string;
} {
  if (!row.actorMemberId && row.actorName === "Atlas")
    return { text: "✦", bg: "var(--viol-t)", ink: "var(--viol)" };
  if (!row.actorMemberId)
    return {
      text: initials(row.actorName.replace(/["“”]/g, "")),
      bg: "var(--sunk)",
      ink: "var(--ink-2)",
    };
  let h = 0;
  for (const c of row.actorName) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const tone = MEMBER_TONES[h % MEMBER_TONES.length]!;
  return { text: initials(row.actorName), ...tone };
}

function dayKey(d: Date, timeZone: string): string {
  return d.toLocaleDateString("en-CA", { timeZone });
}

/** "Today 10:42", "Yesterday 16:24", "13 Oct · 09:10" — in the reader's zone. */
export function whenLabel(t: T, d: Date, now = new Date()): string {
  const tz = t.timeZone;
  const time = t.fmt.time(d, tz);
  if (dayKey(d, tz) === dayKey(now, tz)) return t("settingsV2.audit.today", { time });
  if (dayKey(d, tz) === dayKey(new Date(now.getTime() - 86_400_000), tz))
    return t("settingsV2.audit.yesterday", { time });
  return t.fmt.dateTime(d, tz);
}

export function areaLabel(t: T, area: Area): string {
  return t(`settingsV2.audit.area.${area}` as MessageKey);
}

export function present(t: T, row: AuditRow) {
  const area = areaOf(row.action, row.category);
  return {
    area,
    // Atlas lines are worded by the Atlas module, which writes them.
    sentence:
      (isAtlasAudit(row.action) ? atlasAuditSentence(row, t as unknown as Translate) : null) ??
      auditSentence(t, row, (iso) => {
        const d = new Date(iso);
        return dayKey(d, t.timeZone) === dayKey(new Date(Date.now() + 86_400_000), t.timeZone)
          ? t("settingsV2.audit.tomorrow", { time: t.fmt.time(d, t.timeZone) })
          : whenLabel(t, d);
      }),
  };
}
