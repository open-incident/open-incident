import Link from "next/link";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { isManagerRole } from "@openincident/config";
import { listPaths, listSchedules, myOnCall } from "@/lib/oncall";
import { NewScheduleDialog } from "./new-schedule";
import { activeMembers } from "@/lib/oncall";
import { TIMEZONES } from "@/lib/oncall";

/** The 232 px rail of On-call: schedules, configuration, and whether you are on call right now. */
export async function OnCallRail({
  active,
}: {
  active: { schedule?: string; paths?: boolean; prefs?: boolean };
}) {
  const { tenant, member, workspace } = await requireMember();
  const t = await getT();
  const data = await withTenant(tenant.id, async (tx) => ({
    schedules: await listSchedules(tx, tenant.id),
    paths: await listPaths(tx, tenant.id),
    me: await myOnCall(tx, tenant.id, member.id),
    members: await activeMembers(tx, tenant.id),
  }));
  const item = (on: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "8px 10px",
    borderRadius: 9,
    background: on ? "var(--brand-t)" : "transparent",
    color: on ? "var(--brand)" : "var(--ink-2)",
    fontWeight: on ? 600 : 450,
    fontSize: 13.5,
    textDecoration: "none",
  });
  return (
    <nav
      aria-label={t("oncall.railLabel")}
      style={{
        width: 232,
        flex: "none",
        background: "var(--panel)",
        borderRight: "1px solid var(--line)",
        padding: "16px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        overflow: "auto",
      }}
    >
      <div className="oi-eyebrow" style={{ padding: "0 10px 8px" }}>
        {t("oncall.schedules")}
      </div>
      {data.schedules.map((s) => (
        <Link
          key={s.id}
          href={`/app/on-call?schedule=${s.id}`}
          className={active.schedule === s.id ? undefined : "oi-hover"}
          style={item(active.schedule === s.id)}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {s.name}
          </span>
          <span
            title={s.status === "published" ? t("oncall.published") : t("oncall.draft")}
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: s.status === "published" ? "var(--ok)" : "var(--wait)",
            }}
          />
        </Link>
      ))}
      {isManagerRole(member) && (
        <NewScheduleDialog
          members={data.members}
          timezones={TIMEZONES}
          defaultTimezone={workspace.timezone ?? "Europe/Paris"}
        />
      )}
      <div className="oi-eyebrow" style={{ padding: "14px 10px 8px" }}>
        {t("oncall.configuration")}
      </div>
      <Link
        href="/app/on-call/paths"
        className={active.paths ? undefined : "oi-hover"}
        style={item(Boolean(active.paths))}
      >
        <span style={{ flex: 1 }}>{t("oncall.paths")}</span>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{data.paths.length}</span>
      </Link>
      <Link
        href="/app/on-call/notifications"
        className={active.prefs ? undefined : "oi-hover"}
        style={item(Boolean(active.prefs))}
      >
        <span style={{ flex: 1 }}>{t("oncall.myNotifications")}</span>
      </Link>
      <span style={{ flex: 1 }} />
      <div
        data-testid="oncall-me"
        style={{
          background: "var(--sunk)",
          borderRadius: 14,
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600 }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: data.me ? "var(--dang)" : "var(--ink-3)",
            }}
          />
          {data.me ? t("oncall.youAreOnCall") : t("oncall.youAreOff")}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {data.me
            ? `${data.me.schedule.name} · ${t("oncall.until", { when: t.fmt.dateTime(data.me.until) })}`
            : t("oncall.offNote")}
        </div>
      </div>
    </nav>
  );
}
