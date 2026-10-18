import type { Translate } from "@/i18n/server";

type Sev = { rank: number; name: string };

/**
 * "SEV1", "SEV1 or SEV2", "SEV1 to SEV3" — the severities a threshold covers,
 * from the worst; null when it covers them all (no condition then).
 */
export function severityPhrase(t: Translate, sevs: Sev[], rank: number | null): string | null {
  if (rank === null || sevs.length === 0) return null;
  const sorted = [...sevs].sort((a, b) => a.rank - b.rank);
  const covered = sorted.filter((s) => s.rank <= rank);
  if (covered.length === 0 || covered.length === sorted.length) return null;
  if (covered.length === 1) return covered[0]!.name;
  if (covered.length === 2)
    return t("settingsV2.ann.sevOr", { a: covered[0]!.name, b: covered[1]!.name });
  return t("settingsV2.ann.sevTo", { a: covered[0]!.name, b: covered[covered.length - 1]!.name });
}

/**
 * A rule as the sentence it is — "When a Security incident is declared at
 * SEV1 or SEV2". The announcement engine (lib/announcements.ts) publishes a
 * living post when an incident becomes active and matches, edits it at every
 * change, and closes it at resolution: "declared" is its one moment.
 */
export function ruleSentence(
  t: Translate,
  sevs: Sev[],
  rule: { minSeverityRank: number | null; typeName: string | null },
): string {
  const severity = severityPhrase(t, sevs, rule.minSeverityRank);
  if (rule.typeName && severity)
    return t("settingsV2.ann.whenTypeSev", { type: rule.typeName, severity });
  if (rule.typeName) return t("settingsV2.ann.whenType", { type: rule.typeName });
  if (severity) return t("settingsV2.ann.whenSev", { severity });
  return t("settingsV2.ann.whenAny");
}
