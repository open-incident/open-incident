import Link from "next/link";
import type { payReports } from "@openincident/db";
import { formatCents, type PayRulesLike } from "@openincident/oncall";
import { getT } from "@/i18n/server";
import { generatePayReportAction, publishPayReportAction, savePayRulesAction } from "./pay-actions";

type Report = typeof payReports.$inferSelect;

/**
 * Reports → On-call pay: the workspace's rules, one month computed into a
 * draft, the draft published and frozen. Managers see everyone; a member sees
 * their own lines of published months.
 */
export async function PayTab({
  rules,
  period,
  report,
  history,
  manages,
  memberId,
  saved,
  error,
}: {
  rules: PayRulesLike & { configured: boolean };
  period: string;
  report: Report | null;
  history: Report[];
  manages: boolean;
  memberId: string;
  saved?: string;
  error?: string;
}) {
  const t = await getT();
  const panel: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 14,
    padding: "16px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };
  const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".1em",
    textTransform: "uppercase",
    color: "var(--ink-3)",
  };
  const control: React.CSSProperties = {
    height: 34,
    padding: "0 10px",
    border: "1px solid var(--line)",
    borderRadius: 9,
    fontSize: 13,
    background: "var(--panel)",
    outline: "none",
    width: "100%",
  };
  const brandBtn: React.CSSProperties = {
    height: 34,
    padding: "0 14px",
    borderRadius: 9,
    background: "var(--brand)",
    color: "#fff",
    border: 0,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  };
  const ghostBtn: React.CSSProperties = {
    height: 34,
    padding: "0 12px",
    border: "1px solid var(--line)",
    borderRadius: 9,
    background: "var(--panel)",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    color: "inherit",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
  };
  const euros = (c: number) => (c / 100).toFixed(2);
  const money = (c: number, currency = rules.currency) => formatCents(c, currency, t.locale.tag);
  const hours = (m: number) => `${Math.round(m / 6) / 10} h`;
  const visibleRows = report
    ? manages
      ? report.rows
      : report.status === "published"
        ? report.rows.filter((r) => r.memberId === memberId)
        : []
    : [];
  const byMember = new Map<string, { name: string; rows: typeof visibleRows; total: number }>();
  for (const r of visibleRows) {
    const e = byMember.get(r.memberId) ?? { name: r.memberName, rows: [], total: 0 };
    e.rows.push(r);
    e.total += r.amountCents;
    byMember.set(r.memberId, e);
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: manages ? "minmax(0,3fr) minmax(0,2fr)" : "1fr",
        gap: 14,
        alignItems: "start",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={panel}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("pay.reportTitle")}</span>
            {manages && (
              <form
                action={generatePayReportAction}
                style={{ display: "flex", gap: 8, alignItems: "center" }}
              >
                <input
                  type="month"
                  name="period"
                  defaultValue={period}
                  className="oi-field"
                  data-testid="pay-period"
                  style={{ ...control, width: 160 }}
                />
                <button
                  type="submit"
                  data-testid="pay-generate"
                  style={ghostBtn}
                  disabled={!rules.configured}
                >
                  {report && report.status === "draft" ? t("pay.regenerate") : t("pay.generate")}
                </button>
              </form>
            )}
            <span style={{ flex: 1 }} />
            {report && (
              <span
                data-testid="pay-status"
                style={{
                  padding: "2px 9px",
                  borderRadius: 999,
                  background: report.status === "published" ? "var(--ok-t)" : "var(--wait-t)",
                  color: report.status === "published" ? "var(--ok)" : "var(--wait)",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {t(`pay.status.${report.status}`)}
              </span>
            )}
            {report && manages && report.status === "draft" && (
              <form action={publishPayReportAction}>
                <input type="hidden" name="period" value={period} />
                <button type="submit" data-testid="pay-publish" style={brandBtn}>
                  {t("pay.publish")}
                </button>
              </form>
            )}
            {report && (manages || report.status === "published") && (
              <a
                href={`/api/insights/export?tab=pay&period=${period}`}
                className="oi-hover"
                style={ghostBtn}
              >
                ↓ CSV
              </a>
            )}
          </div>
          {saved === "rules" && (
            <div role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
              {t("pay.rulesSaved")}
            </div>
          )}
          {saved === "draft" && (
            <div role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
              {t("pay.draftGenerated")}
            </div>
          )}
          {saved === "published" && (
            <div role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
              {t("pay.published")}
            </div>
          )}
          {error === "published" && (
            <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
              {t("pay.errorPublished")}
            </div>
          )}
          {error === "rules" && (
            <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
              {t("pay.errorRules")}
            </div>
          )}
          {!rules.configured && <div className="oi-note">{t("pay.noRules")}</div>}
          {!report && rules.configured && (
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {manages ? t("pay.noReport", { period }) : t("pay.noReportMember", { period })}
            </div>
          )}
          {report && visibleRows.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {manages ? t("pay.emptyReport") : t("pay.emptyForYou")}
            </div>
          )}
          {byMember.size > 0 && (
            <div
              style={{ border: "1px solid var(--line-2)", borderRadius: 10, overflow: "hidden" }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "minmax(140px,2fr) repeat(4, minmax(64px,1fr)) minmax(90px,1fr)",
                  gap: 8,
                  padding: "7px 10px",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                  background: "var(--sunk)",
                }}
              >
                <span>{t("pay.col.member")}</span>
                <span>{t("pay.cat.standby")}</span>
                <span>{t("pay.cat.night")}</span>
                <span>{t("pay.cat.weekend")}</span>
                <span>{t("pay.cat.holiday")}</span>
                <span style={{ textAlign: "right" }}>{t("pay.col.amount")}</span>
              </div>
              {[...byMember.entries()].map(([id, m]) => (
                <div
                  key={id}
                  data-testid="pay-row"
                  style={{ borderTop: "1px solid var(--line-2)" }}
                >
                  {m.rows.map((r) => (
                    <div
                      key={`${r.memberId}-${r.scheduleId}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "minmax(140px,2fr) repeat(4, minmax(64px,1fr)) minmax(90px,1fr)",
                        gap: 8,
                        padding: "7px 10px",
                        fontSize: 12.5,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      <span
                        style={{
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <strong>{r.memberName}</strong>{" "}
                        <span style={{ color: "var(--ink-3)" }}>· {r.scheduleName}</span>
                      </span>
                      <span>{hours(r.minutes.standby)}</span>
                      <span>{hours(r.minutes.night)}</span>
                      <span>{hours(r.minutes.weekend)}</span>
                      <span>{hours(r.minutes.holiday)}</span>
                      <span style={{ textAlign: "right", fontWeight: 600 }}>
                        {money(r.amountCents, report?.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              {manages && report && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 10,
                    padding: "9px 10px",
                    borderTop: "1px solid var(--line)",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  <span>{t("pay.total")}</span>
                  <span data-testid="pay-total">{money(report.totalCents, report.currency)}</span>
                </div>
              )}
            </div>
          )}
          {report && (
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {t("pay.generatedAt", { when: t.fmt.dateTime(report.generatedAt, t.timeZone) })}
              {report.publishedAt
                ? ` · ${t("pay.publishedAt", { when: t.fmt.dateTime(report.publishedAt, t.timeZone) })}`
                : ""}
            </div>
          )}
        </div>
        {history.length > 0 && (
          <div style={panel}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("pay.history")}</span>
            {history.map((h) => (
              <Link
                key={h.id}
                href={`/app/insights?tab=pay&period=${h.period}`}
                className="oi-hover"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 8px",
                  margin: "0 -8px",
                  borderRadius: 8,
                  textDecoration: "none",
                  color: "inherit",
                  fontSize: 12.5,
                }}
              >
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{h.period}</span>
                <span
                  style={{
                    padding: "1px 7px",
                    borderRadius: 999,
                    background: h.status === "published" ? "var(--ok-t)" : "var(--wait-t)",
                    color: h.status === "published" ? "var(--ok)" : "var(--wait)",
                    fontSize: 10.5,
                    fontWeight: 700,
                  }}
                >
                  {t(`pay.status.${h.status}`)}
                </span>
                <span style={{ flex: 1 }} />
                {(manages || h.status === "published") && (
                  <span style={{ fontWeight: 600 }}>
                    {manages ? money(h.totalCents, h.currency) : ""}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
          {t("pay.footnote")}
        </div>
      </div>
      {manages && (
        <form action={savePayRulesAction} data-testid="pay-rules" style={panel}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t("pay.rulesTitle")}</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={label}>{t("pay.currency")}</span>
              <input
                name="currency"
                defaultValue={rules.currency}
                maxLength={3}
                className="oi-field"
                style={{ ...control, fontFamily: "var(--font-mono)" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={label}>{t("pay.cat.standby")} / h</span>
              <input
                name="standby"
                type="number"
                step="0.01"
                min="0"
                defaultValue={euros(rules.standbyCents)}
                className="oi-field"
                style={control}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={label}>{t("pay.cat.night")} / h</span>
              <input
                name="night"
                type="number"
                step="0.01"
                min="0"
                defaultValue={euros(rules.nightCents)}
                className="oi-field"
                style={control}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={label}>{t("pay.cat.weekend")} / h</span>
              <input
                name="weekend"
                type="number"
                step="0.01"
                min="0"
                defaultValue={euros(rules.weekendCents)}
                className="oi-field"
                style={control}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={label}>{t("pay.cat.holiday")} / h</span>
              <input
                name="holiday"
                type="number"
                step="0.01"
                min="0"
                defaultValue={euros(rules.holidayCents)}
                className="oi-field"
                style={control}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={label}>{t("pay.nightStart")}</span>
              <input
                name="nightStart"
                type="time"
                defaultValue={rules.nightStart}
                className="oi-field"
                style={control}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={label}>{t("pay.nightEnd")}</span>
              <input
                name="nightEnd"
                type="time"
                defaultValue={rules.nightEnd}
                className="oi-field"
                style={control}
              />
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={label}>{t("pay.holidays")}</span>
            <textarea
              name="holidays"
              rows={5}
              defaultValue={rules.holidays.join("\n")}
              placeholder="2026-12-25"
              className="oi-field"
              style={{
                ...control,
                height: "auto",
                padding: "8px 10px",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                resize: "vertical",
              }}
            />
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("pay.holidaysHint")}</span>
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" data-testid="pay-rules-save" style={brandBtn}>
              {t("common.save")}
            </button>
          </div>
          <div
            style={{
              background: "var(--sunk)",
              borderRadius: 11,
              padding: "11px 13px",
              fontSize: 12,
              color: "var(--ink-2)",
              lineHeight: 1.5,
            }}
          >
            {t("pay.rulesNote")}
          </div>
        </form>
      )}
    </div>
  );
}
