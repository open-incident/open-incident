import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import {
  escalationPathVersions,
  escalationPaths,
  withTenant,
  workingHoursSets,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { TIMEZONES } from "@/lib/oncall";
import { deleteWorkingHours, saveWorkingHours } from "./actions";

/** Settings → Working hours: named sets, consumed by the "working hours" conditions of escalation paths. */
export default async function WorkingHoursPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { tenant, workspace } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const data = await withTenant(tenant.id, async (tx) => {
    const sets = await tx
      .select()
      .from(workingHoursSets)
      .where(eq(workingHoursSets.tenantId, tenant.id))
      .orderBy(asc(workingHoursSets.createdAt));
    const paths = await tx
      .select({
        id: escalationPaths.id,
        name: escalationPaths.name,
        currentVersionId: escalationPaths.currentVersionId,
        draft: escalationPaths.draftGraph,
      })
      .from(escalationPaths)
      .where(eq(escalationPaths.tenantId, tenant.id));
    const versions = await tx
      .select({ id: escalationPathVersions.id, graph: escalationPathVersions.graph })
      .from(escalationPathVersions)
      .where(eq(escalationPathVersions.tenantId, tenant.id));
    const usage = new Map<string, number>();
    for (const p of paths) {
      const g = p.draft ?? versions.find((v) => v.id === p.currentVersionId)?.graph;
      const ids = new Set<string>();
      for (const n of g?.nodes ?? []) {
        if (n.kind === "condition" && n.test.type === "working_hours") ids.add(n.test.setId);
        if (n.kind === "delay" && n.untilWorkingHoursSetId) ids.add(n.untilWorkingHoursSetId);
      }
      for (const id of ids) usage.set(id, (usage.get(id) ?? 0) + 1);
    }
    return { sets, usage };
  });
  const editing = q.edit === "new" ? "new" : (data.sets.find((s) => s.id === q.edit) ?? null);
  const r = editing === "new" ? null : editing;
  const dayNames = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".1em",
    textTransform: "uppercase",
    color: "var(--ink-3)",
  };
  const control: React.CSSProperties = {
    height: 36,
    padding: "0 11px",
    border: "1px solid var(--line)",
    borderRadius: 9,
    outline: "none",
    fontSize: 12.5,
    background: "var(--panel)",
    width: "100%",
  };
  const rangeLabel = (s: (typeof data.sets)[number]) => {
    const ds = s.days.slice().sort();
    const contiguous = ds.every((d, i) => i === 0 || d === ds[i - 1]! + 1);
    const daysText =
      contiguous && ds.length > 1
        ? `${t(`oncall.day.${dayNames[ds[0]! - 1]!}`)} – ${t(`oncall.day.${dayNames[ds[ds.length - 1]! - 1]!}`)}`
        : ds.map((d) => t(`oncall.day.${dayNames[d - 1]!}`)).join(", ");
    return `${daysText} · ${s.startTime} – ${s.endTime} · ${s.timezone}`;
  };
  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 860 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.hours.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("settings.hours.subtitle")}
        </span>
        <span style={{ flex: 1 }} />
        {q.saved === "1" && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        {q.error && (
          <span role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}>
            {t("settings.fields.errorInvalid")}
          </span>
        )}
        <Link
          href="/app/settings/working-hours?edit=new"
          data-testid="hours-new"
          style={{
            height: 32,
            padding: "0 14px",
            borderRadius: 9,
            background: "var(--brand)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            fontSize: 12.5,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {t("settings.hours.new")}
        </Link>
      </div>
      {data.sets.map((s) => {
        const used = data.usage.get(s.id) ?? 0;
        return (
          <div
            key={s.id}
            data-testid="hours-row"
            className="oi-panel"
            style={{
              padding: "15px 18px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.name}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{rangeLabel(s)}</div>
            </div>
            <span
              style={{
                padding: "2px 9px",
                borderRadius: 999,
                background: used ? "var(--brand-t)" : "var(--sunk)",
                color: used ? "var(--brand)" : "var(--ink-2)",
                fontSize: 10.5,
                fontWeight: 700,
              }}
            >
              {used ? t("settings.hours.usedBy", { count: used }) : t("settings.hours.unused")}
            </span>
            <Link
              href={`/app/settings/working-hours?edit=${s.id}`}
              className="oi-hover"
              style={{
                height: 28,
                padding: "0 11px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                fontSize: 11.5,
                fontWeight: 600,
                color: "inherit",
                textDecoration: "none",
              }}
            >
              {t("common.edit")}
            </Link>
            {!used && (
              <form action={deleteWorkingHours}>
                <input type="hidden" name="id" value={s.id} />
                <button
                  type="submit"
                  aria-label={t("common.delete")}
                  className="oi-hover-dang"
                  style={{
                    width: 28,
                    height: 28,
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    background: "var(--panel)",
                    color: "var(--dang)",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  ✕
                </button>
              </form>
            )}
          </div>
        );
      })}
      <div
        style={{
          background: "var(--sunk)",
          borderRadius: 14,
          padding: "13px 15px",
          fontSize: 12.5,
          color: "var(--ink-2)",
          lineHeight: 1.55,
        }}
      >
        {t("settings.hours.note")}
      </div>
      {editing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim-dialog)",
            display: "grid",
            placeItems: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <form
            action={saveWorkingHours}
            data-testid="hours-form"
            role="dialog"
            className="oi-rise"
            style={{
              width: 520,
              maxWidth: "100%",
              background: "var(--panel)",
              borderRadius: 18,
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <input type="hidden" name="id" value={r?.id ?? ""} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div style={{ fontFamily: "var(--font-title)", fontSize: 16.5, fontWeight: 600 }}>
                {r ? t("settings.hours.editTitle", { name: r.name }) : t("settings.hours.newTitle")}
              </div>
              <Link
                href="/app/settings/working-hours"
                aria-label={t("common.close")}
                style={{
                  marginLeft: "auto",
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--ink-3)",
                  fontSize: 14,
                  textDecoration: "none",
                }}
              >
                ✕
              </Link>
            </div>
            <div
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 13 }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("oncall.name")}</span>
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={60}
                    defaultValue={r?.name ?? ""}
                    placeholder="EU business"
                    className="oi-field"
                    style={control}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("oncall.timezone")}</span>
                  <select
                    name="timezone"
                    defaultValue={r?.timezone ?? workspace.timezone ?? "Europe/Paris"}
                    className="oi-field"
                    style={control}
                  >
                    {[
                      ...new Set(
                        [r?.timezone, workspace.timezone, ...TIMEZONES].filter((x): x is string =>
                          Boolean(x),
                        ),
                      ),
                    ].map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.hours.days")}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {dayNames.map((d, i) => (
                    <label
                      key={d}
                      style={{
                        flex: 1,
                        textAlign: "center",
                        padding: "6px 0",
                        border: "1px solid var(--line)",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        name="days"
                        value={i + 1}
                        defaultChecked={r ? r.days.includes(i + 1) : i < 5}
                      />{" "}
                      {t(`oncall.day.${d}`)}
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("oncall.from")}</span>
                  <input
                    name="startTime"
                    type="time"
                    required
                    defaultValue={r?.startTime ?? "09:00"}
                    className="oi-field"
                    style={control}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("oncall.to")}</span>
                  <input
                    name="endTime"
                    type="time"
                    required
                    defaultValue={r?.endTime ?? "18:00"}
                    className="oi-field"
                    style={control}
                  />
                </label>
              </div>
              <div
                className="oi-note"
                style={{ borderRadius: 11, padding: "11px 13px", fontSize: 12 }}
              >
                {t("settings.hours.formNote")}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "14px 20px",
                borderTop: "1px solid var(--line)",
              }}
            >
              <span style={{ flex: 1 }} />
              <Link
                href="/app/settings/working-hours"
                className="oi-hover"
                style={{
                  height: 34,
                  padding: "0 13px",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  background: "var(--panel)",
                  display: "flex",
                  alignItems: "center",
                  fontSize: 12.5,
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                {t("common.cancel")}
              </Link>
              <button
                type="submit"
                style={{
                  height: 34,
                  padding: "0 16px",
                  borderRadius: 9,
                  background: "var(--brand)",
                  color: "#fff",
                  border: 0,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {r ? t("common.save") : t("common.create")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
