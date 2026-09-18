import Link from "next/link";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { NowTab } from "./now-tab";
import { SchedulesTab } from "./schedules-tab";
import { PoliciesTab } from "./policies-tab";
import { NotificationsTab } from "./notifications-tab";

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
 * On-call, in one screen and four tabs.
 *
 * Who is on call was spread over three pages — the week, the escalation paths,
 * the personal notification rules — and the question they answer is one
 * question: does the pager reach somebody. `?tab=` picks the face; the two old
 * addresses still answer and land on the tab that replaced them.
 */
export default async function OnCallPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireMember();
  const t = await getT();
  const q = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(q.tab ?? "") ? (q.tab as Tab) : "now";

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
    >
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
      {tab === "policies" && <PoliciesTab />}
      {tab === "notifications" && <NotificationsTab q={q} />}
    </div>
  );
}
