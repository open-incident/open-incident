import type { Translate } from "@/i18n/server";
import { isToday, whenCompact } from "../when";

const DAY = 86_400_000;

export type SourceState = "paused" | "test" | "waiting" | "quiet" | "receiving";

/**
 * How a source is doing, in one word and a colour — the dot on its card and
 * next to its name. Read off its real `lastAlertAt`: a source silent for a
 * week is "quiet", which is the state a broken subscription looks like.
 */
export function sourceStatus(
  t: Translate,
  s: { active: boolean; testMode: boolean; lastAlertAt: Date | null },
  now: Date = new Date(),
): { state: SourceState; label: string; ink: string; quietDays: number | null } {
  const quietDays = s.lastAlertAt
    ? Math.floor((now.getTime() - s.lastAlertAt.getTime()) / DAY)
    : null;
  if (!s.active)
    return { state: "paused", label: t("alt2.sources.st.paused"), ink: "var(--ink-3)", quietDays };
  if (s.testMode)
    return { state: "test", label: t("alt2.sources.st.test"), ink: "var(--viol)", quietDays };
  if (quietDays === null)
    return { state: "waiting", label: t("alt2.sources.st.waiting"), ink: "var(--wait)", quietDays };
  if (quietDays >= 7)
    return {
      state: "quiet",
      label: t("alt2.sources.st.quiet", { count: quietDays }),
      ink: "var(--wait)",
      quietDays,
    };
  return { state: "receiving", label: t("alt2.sources.st.receiving"), ink: "var(--ok)", quietDays };
}

/** What to check when a tool went quiet — the place its subscription lives. */
const HINT: Record<string, string> = {
  datadog: "alst.sources.hint.datadog",
  prometheus: "alst.sources.hint.prometheus",
  grafana: "alst.sources.hint.grafana",
  sentry: "alst.sources.hint.sentry",
  cloudwatch: "alst.sources.hint.cloudwatch",
  uptime_kuma: "alst.sources.hint.uptime_kuma",
};

/**
 * The line at the foot of a source card: how much it sent over 90 days and
 * when last — or, for a quiet one, how long it has been silent and where to
 * look; for one on trial, how many test alerts paged nobody.
 */
export function sourceMeta(
  t: Translate,
  s: { kind: string; lastAlertAt: Date | null },
  status: ReturnType<typeof sourceStatus>,
  counts: { all: number; test: number },
  now: Date = new Date(),
): string {
  if (status.state === "test") return t("alst.sources.metaTest", { count: counts.test });
  if (!s.lastAlertAt) return t("alt2.sources.metaWaiting");
  if (status.state === "quiet")
    return t("alst.sources.metaQuiet", {
      days: status.quietDays ?? 0,
      hint: t((HINT[s.kind] ?? "alst.sources.hint.http") as "alst.sources.hint.http"),
    });
  const base = t("alst.sources.meta", { count: counts.all });
  return isToday(t, s.lastAlertAt, now)
    ? `${base} · ${t("alst.sources.last", { when: whenCompact(t, s.lastAlertAt, now) })}`
    : base;
}
