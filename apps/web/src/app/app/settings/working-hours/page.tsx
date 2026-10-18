import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { withTenant, workingHoursSets } from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { TIMEZONES } from "@/lib/oncall";
import { Note, SettingsPage, cardStyle } from "@/components/settings/template";
import { DeleteSetDialog, SetDialog } from "./set-dialog";
import { setsUsage } from "./usage";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * Settings › Working hours (design V2): the named sets on the left, the one
 * selected on the right as a week — a bar per day on a 24-hour axis — and
 * the policies that read it. Policies page differently in and out of these
 * hours; a set a policy reads cannot be deleted.
 */
export default async function WorkingHoursPage({
  searchParams,
}: {
  searchParams: Promise<{ set?: string }>;
}) {
  const { tenant, workspace, member } = await requireMember();
  const t = await getT();
  const { set: selectedId } = await searchParams;
  const manages = isManager(member);
  const sets = await withTenant(tenant.id, (tx) =>
    tx
      .select()
      .from(workingHoursSets)
      .where(eq(workingHoursSets.tenantId, tenant.id))
      .orderBy(asc(workingHoursSets.createdAt)),
  );
  const usage = await setsUsage(tenant.id);
  const current = sets.find((s) => s.id === selectedId) ?? sets[0];
  const usedLine = (id: string) => {
    const names = usage.get(id) ?? [];
    return names.length
      ? t("settingsV2.hours.usedBy", { count: names.length, names: names.join(", ") })
      : t("settingsV2.hours.notUsed");
  };
  const readers = current ? (usage.get(current.id) ?? []) : [];
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };

  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.workspace")}
      title={t("settingsV2.entry.hours")}
      lead={t("settingsV2.hours.lead")}
      testId="settings-hours"
      actions={
        manages ? (
          <SetDialog timezones={[...TIMEZONES]} defaultTimezone={workspace.timezone} />
        ) : undefined
      }
    >
      {!current ? (
        <Note>{t("settingsV2.hours.empty")}</Note>
      ) : (
        <div style={{ ...cardStyle, display: "flex", flexWrap: "wrap" }}>
          <div
            style={{
              flex: "1 1 220px",
              maxWidth: 290,
              borderRight: "1px solid var(--line)",
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            {sets.map((s) => {
              const on = s.id === current.id;
              return (
                <Link
                  key={s.id}
                  href={`/app/settings/working-hours?set=${s.id}`}
                  scroll={false}
                  data-testid="hours-row"
                  aria-current={on ? "true" : undefined}
                  className={on ? undefined : "oi-hover"}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    cursor: "pointer",
                    background: on ? "var(--brand-t)" : "transparent",
                    border: `1px solid ${on ? "var(--brand-b)" : "transparent"}`,
                    color: "inherit",
                    textDecoration: "none",
                  }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                    {`${s.timezone} · ${usedLine(s.id)}`}
                  </div>
                </Link>
              );
            })}
          </div>
          <div
            data-testid="hours-week"
            style={{
              flex: "10 1 420px",
              minWidth: 0,
              padding: "14px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{current.name}</span>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{current.timezone}</span>
              <span style={{ flex: 1 }} />
              {manages && !readers.length && (
                <DeleteSetDialog id={current.id} name={current.name} />
              )}
              {manages && (
                <SetDialog
                  key={current.id}
                  set={{
                    id: current.id,
                    name: current.name,
                    days: current.days,
                    startTime: current.startTime,
                    endTime: current.endTime,
                    timezone: current.timezone,
                  }}
                  timezones={[...TIMEZONES]}
                  defaultTimezone={workspace.timezone}
                />
              )}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "40px minmax(0,1fr) 104px",
                gap: 10,
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: "var(--ink-3)",
              }}
            >
              <span />
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                {["00", "06", "12", "18", "24"].map((h) => (
                  <span key={h}>{h}</span>
                ))}
              </div>
              <span />
            </div>
            {DAY_KEYS.map((d, i) => {
              const on = current.days.includes(i + 1);
              const from = minutes(current.startTime);
              const to = minutes(current.endTime);
              return (
                <div
                  key={d}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "40px minmax(0,1fr) 104px",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {t(`settingsV2.hours.${d}`)}
                  </span>
                  <div
                    style={{
                      position: "relative",
                      height: 20,
                      borderRadius: 6,
                      background: "var(--sunk)",
                    }}
                  >
                    {on &&
                      // An end at or before the start runs past midnight: two segments.
                      (to > from
                        ? [[from, to]]
                        : [
                            [from, 1440],
                            [0, to],
                          ]
                      ).map(([a, b], k) => (
                        <span
                          key={k}
                          style={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            left: `${(a! / 1440) * 100}%`,
                            width: `${((b! - a!) / 1440) * 100}%`,
                            borderRadius: 6,
                            background: "var(--brand)",
                          }}
                        />
                      ))}
                  </div>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      color: on ? "var(--ink)" : "var(--ink-3)",
                      textAlign: "right",
                    }}
                  >
                    {on ? `${current.startTime} – ${current.endTime}` : t("settingsV2.hours.off")}
                  </span>
                </div>
              );
            })}
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-3)",
                borderTop: "1px solid var(--line-2)",
                paddingTop: 9,
                marginTop: 2,
              }}
            >
              {readers.length
                ? t("settingsV2.hours.readBy", {
                    count: readers.length,
                    names:
                      readers.length === 1 ? readers[0]! : readers.map((n) => `“${n}”`).join(", "),
                  })
                : t("settingsV2.hours.readByNone")}
            </div>
          </div>
        </div>
      )}
      <Note>{t("settingsV2.hours.note")}</Note>
    </SettingsPage>
  );
}
