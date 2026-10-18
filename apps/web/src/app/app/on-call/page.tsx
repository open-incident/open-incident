import Link from "next/link";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { NowTab } from "./now-tab";
import { SchedulesTab } from "./schedules-tab";
import { PoliciesTab } from "./policies-tab";
import { NotificationsTab } from "./notifications-tab";
import { TeamsTab } from "./teams-tab";

/** The four faces the design draws, in its order. */
const TABS = ["now", "schedules", "policies", "notifications"] as const;
type Tab = (typeof TABS)[number];

const LABEL: Record<
  Tab,
  "oc2.tab.now" | "oc2.tab.schedules" | "oc2.tab.policies" | "oc2.tab.notifications"
> = {
  now: "oc2.tab.now",
  schedules: "oc2.tab.schedules",
  policies: "oc2.tab.policies",
  notifications: "oc2.tab.notifications",
};

/**
 * The hovers this screen draws that the shared vocabulary has no class for:
 * a grid cell rings in brand tint, a person chip takes a brand hairline, a
 * rule step shows its remove cross.
 */
const HOVERS = `
.oi-cell:hover:not([aria-current]) { box-shadow: 0 0 0 2px var(--brand-b) !important; }
.oi-hover-chip:hover { border-color: var(--brand) !important; }
.oi-step .oi-step-x { opacity: 0; }
.oi-step:hover .oi-step-x, .oi-step .oi-step-x:focus-visible { opacity: 1; }
`;

/**
 * On-call, in one screen and four tabs: Now, Schedules, Policies, My
 * notifications.
 *
 * Who is on call was spread over three pages — the week, the escalation paths,
 * the personal notification rules — and the question they answer is one
 * question: does the pager reach somebody. `?tab=` picks the face; the old
 * addresses still answer and land on the tab that replaced them.
 *
 * Teams have no tab of their own in the design: `?tab=teams` still answers,
 * reached from the Policies tab, because a team is what a policy is the
 * default of — the tab bar then shows Policies as the current face.
 */
export default async function OnCallPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireMember();
  const t = await getT();
  const q = await searchParams;
  const teamsView = q.tab === "teams";
  const tab: Tab = (TABS as readonly string[]).includes(q.tab ?? "")
    ? (q.tab as Tab)
    : teamsView
      ? "policies"
      : "now";

  return (
    <div
      style={{
        maxWidth: 1160,
        margin: "0 auto",
        padding: "22px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
      data-screen-label="On-call"
    >
      <style>{HOVERS}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t("oc2.title")}
        </h1>
        <div
          style={{
            display: "flex",
            gap: 2,
            background: "var(--sunk)",
            borderRadius: 10,
            padding: 3,
          }}
        >
          {TABS.map((id) => {
            const on = id === tab;
            return (
              <Link
                key={id}
                href={`/app/on-call?tab=${id}`}
                aria-current={on ? "page" : undefined}
                data-testid={`oncall-tab-${id}`}
                style={{
                  height: 28,
                  padding: "0 12px",
                  borderRadius: 8,
                  background: on ? "var(--panel)" : "transparent",
                  color: on ? "var(--ink)" : "var(--ink-3)",
                  boxShadow: on ? "var(--shadow-card)" : "none",
                  display: "flex",
                  alignItems: "center",
                  fontSize: 12.5,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                {t(LABEL[id])}
              </Link>
            );
          })}
        </div>
      </div>
      {tab === "now" && <NowTab q={q} />}
      {tab === "schedules" && <SchedulesTab q={q} />}
      {tab === "policies" && (teamsView ? <TeamsTab q={q} /> : <PoliciesTab />)}
      {tab === "notifications" && <NotificationsTab q={q} />}
    </div>
  );
}
