import { getT, type Translate } from "@/i18n/server";
import { atlasAvailable } from "./data";
import { atlasInsights, share } from "./insights-data";
import { levelKey, panel } from "./ui";

const GRADE_COLOR = {
  bullseye: "var(--ok)",
  on_target: "#5FB38E",
  miss: "var(--wait)",
  nowhere_near: "var(--dang)",
} as const;

function Kpi({
  label,
  value,
  delta,
  good,
  sub,
}: {
  label: string;
  value: string;
  delta: string | null;
  good: boolean;
  sub: string;
}) {
  return (
    <div style={{ ...panel, padding: "13px 16px" }} data-testid="atlas-kpi">
      <div
        style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", color: "var(--ink-3)" }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3 }}>
        <span
          style={{
            fontFamily: "var(--title)",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "-.02em",
          }}
        >
          {value}
        </span>
        {delta && (
          <span
            style={{ fontSize: 11.5, fontWeight: 700, color: good ? "var(--ok)" : "var(--dang)" }}
          >
            {delta}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{sub}</div>
    </div>
  );
}

/** "+21 pts", "−2 pts", "±0 pts" — the change of a share between two periods. */
function pts(t: Translate, now: number | null, before: number | null): string | null {
  if (now == null || before == null) return null;
  const d = Math.round(now - before);
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  return t("atlas.ui.ins.pts", { value: `${sign}${t.fmt.number(Math.abs(d))}` });
}

/**
 * Insights › ✦ Atlas: the four figures (resolved alone, Atlas's time to
 * resolve against people's, how often it was right, how often a person undid
 * it, with the cost per incident), who resolved each week, the services with
 * their level, and the grades over the period — every one computed from the
 * workspace's rows. The KPI row is part of the tab: the host draws its own
 * only on the other tabs. Owner: atlas-ui.
 */
export async function AtlasInsightsTab({ tenantId, days }: { tenantId: string; days: number }) {
  const t = await getT();
  if (!(await atlasAvailable()))
    return (
      <div
        data-testid="atlas-insights"
        style={{
          border: "1px dashed var(--line)",
          borderRadius: "var(--radius-card)",
          padding: 26,
          textAlign: "center",
          fontSize: 13,
          color: "var(--ink-2)",
        }}
      >
        {t("atlas.ui.review.unavailable")}
      </div>
    );
  const d = await atlasInsights(tenantId, days);
  const { now, before } = d;
  const aloneNow = share(now.alone, now.resolved);
  const aloneBefore = share(before.alone, before.resolved);
  const rightNow = share(now.right, now.graded);
  const rightBefore = share(before.right, before.graded);
  const undoNow = share(now.undone, now.actions);
  const undoBefore = share(before.undone, before.actions);
  const pctText = (n: number | null) =>
    n == null ? "—" : t("atlas.ui.ins.pct", { value: t.fmt.number(Math.round(n)) });
  const ttrDelta =
    now.ttrAlone != null && now.ttrPeople != null ? now.ttrAlone - now.ttrPeople : null;
  const maxWeek = Math.max(1, ...d.weeks.map((w) => w.alone + w.approved + w.people));
  const gradedTotal = Object.values(d.grades).reduce((a, b) => a + b, 0);
  const h = (n: number) => `${(n / maxWeek) * 100}%`;

  return (
    <div
      data-testid="atlas-insights"
      style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        <Kpi
          label={t("atlas.ui.ins.kpi.alone")}
          value={pctText(aloneNow)}
          delta={pts(t, aloneNow, aloneBefore)}
          good={(aloneNow ?? 0) >= (aloneBefore ?? 0)}
          sub={t("atlas.ui.ins.kpi.aloneSub", { count: now.alone, total: now.resolved })}
        />
        <Kpi
          label={t("atlas.ui.ins.kpi.ttr")}
          value={now.ttrAlone == null ? "—" : t.fmt.duration(now.ttrAlone)}
          delta={
            ttrDelta == null
              ? null
              : `${ttrDelta < 0 ? "−" : ttrDelta > 0 ? "+" : "±"}${t.fmt.duration(Math.abs(ttrDelta))}`
          }
          good={(ttrDelta ?? 0) <= 0}
          sub={
            now.ttrPeople == null
              ? t("atlas.ui.ins.kpi.ttrSubNone")
              : t("atlas.ui.ins.kpi.ttrSub", { people: t.fmt.duration(now.ttrPeople) })
          }
        />
        <Kpi
          label={t("atlas.ui.ins.kpi.right")}
          value={pctText(rightNow)}
          delta={pts(t, rightNow, rightBefore)}
          good={(rightNow ?? 0) >= (rightBefore ?? 0)}
          sub={t("atlas.ui.ins.kpi.rightSub", { count: now.graded })}
        />
        <Kpi
          label={t("atlas.ui.ins.kpi.undone")}
          value={pctText(undoNow)}
          delta={pts(t, undoNow, undoBefore)}
          good={(undoNow ?? 0) <= (undoBefore ?? 0)}
          sub={
            now.costPerIncident == null
              ? t("atlas.ui.ins.kpi.undoneSub", { count: now.undone, total: now.actions })
              : t("atlas.ui.ins.kpi.undoneSubCost", {
                  count: now.undone,
                  total: now.actions,
                  cost: t("atlas.ui.eur", { amount: t.fmt.amount(now.costPerIncident) }),
                })
          }
        />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <div
          style={{
            flex: "10 1 460px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              ...panel,
              padding: "14px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t("atlas.ui.ins.weekly")}</span>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {t("atlas.ui.ins.weeklyHint")}
              </span>
            </div>
            <div
              data-testid="atlas-weeks"
              style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 130 }}
            >
              {d.weeks.map((w, i) => (
                <div
                  key={i}
                  title={`${t.fmt.dateCompact(w.start)} · ${w.alone} / ${w.approved} / ${w.people}`}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column-reverse",
                    height: "100%",
                    gap: 2,
                  }}
                >
                  <span
                    style={{
                      height: h(w.people),
                      background: "var(--brand-b)",
                      borderRadius: "0 0 3px 3px",
                    }}
                  />
                  <span style={{ height: h(w.approved), background: "var(--brand-2)" }} />
                  <span
                    style={{
                      height: h(w.alone),
                      background: "var(--viol)",
                      borderRadius: "3px 3px 0 0",
                    }}
                  />
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                gap: 14,
                fontSize: 11.5,
                color: "var(--ink-2)",
                flexWrap: "wrap",
              }}
            >
              {(
                [
                  ["var(--viol)", t("atlas.ui.ins.legend.alone")],
                  ["var(--brand-2)", t("atlas.ui.ins.legend.approved")],
                  ["var(--brand-b)", t("atlas.ui.ins.legend.people")],
                ] as const
              ).map(([c, l]) => (
                <span key={l} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />
                  {l}
                </span>
              ))}
              <span style={{ flex: 1 }} />
              <span>{t("atlas.ui.ins.range", { from: t.fmt.dateCompact(d.weeks[0]!.start) })}</span>
            </div>
          </div>

          <div style={{ ...panel, overflowX: "auto" }}>
            <div style={{ minWidth: 600 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(130px,1fr) 110px 80px 90px 90px 80px",
                  gap: 10,
                  padding: "9px 18px",
                  background: "var(--sunk)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                }}
              >
                <span>{t("atlas.ui.ins.col.service")}</span>
                <span>{t("atlas.ui.ins.col.level")}</span>
                <span>{t("atlas.ui.ins.col.runs")}</span>
                <span>{t("atlas.ui.ins.col.right")}</span>
                <span>{t("atlas.ui.ins.col.resolve")}</span>
                <span>{t("atlas.ui.ins.col.undone")}</span>
              </div>
              {d.services.map((s) => (
                <div
                  key={s.serviceId}
                  data-testid="atlas-insights-service"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(130px,1fr) 110px 80px 90px 90px 80px",
                    gap: 10,
                    alignItems: "center",
                    padding: "9px 18px",
                    borderTop: "1px solid var(--line-2)",
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{s.key}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--viol)" }}>
                    {t("atlas.ui.levelShort", {
                      level: s.effective,
                      name: t(`atlas.ui.level.${levelKey(s.effective)}`),
                    })}
                  </span>
                  <span style={{ fontFamily: "var(--mono)" }}>{t.fmt.number(s.gradedRuns)}</span>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontWeight: 600,
                      color:
                        s.rightPct == null
                          ? "var(--ink-3)"
                          : s.rightPct >= 90
                            ? "var(--ok)"
                            : "var(--wait)",
                    }}
                  >
                    {s.rightPct == null ? "—" : pctText(s.rightPct)}
                  </span>
                  <span style={{ fontFamily: "var(--mono)" }}>
                    {s.ttr == null ? "—" : t.fmt.duration(s.ttr)}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      color: s.undone ? "var(--dang)" : "var(--ink-3)",
                    }}
                  >
                    {t.fmt.number(s.undone)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          style={{
            flex: "1 1 280px",
            maxWidth: 360,
            minWidth: 260,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              ...panel,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 9,
            }}
            data-testid="atlas-grades"
          >
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>
              {t("atlas.ui.ins.grades", { count: days })}
            </div>
            <div
              style={{
                display: "flex",
                height: 10,
                borderRadius: 999,
                overflow: "hidden",
                background: gradedTotal ? undefined : "var(--sunk)",
              }}
            >
              {(Object.keys(d.grades) as Array<keyof typeof d.grades>).map((g) => (
                <span
                  key={g}
                  style={{
                    width: gradedTotal ? `${((d.grades[g] / gradedTotal) * 100).toFixed(1)}%` : 0,
                    background: GRADE_COLOR[g],
                  }}
                />
              ))}
            </div>
            {(Object.keys(d.grades) as Array<keyof typeof d.grades>).map((g) => (
              <div key={g} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span
                  style={{ width: 9, height: 9, borderRadius: 3, background: GRADE_COLOR[g] }}
                />
                <span style={{ flex: 1 }}>{t(`ai.investigation.grade.${g}`)}</span>
                <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>
                  {t.fmt.number(d.grades[g])}
                </span>
              </div>
            ))}
            <div
              style={{
                fontSize: 11.5,
                color: "var(--ink-3)",
                lineHeight: 1.45,
                borderTop: "1px solid var(--line-2)",
                paddingTop: 7,
              }}
            >
              {t("atlas.ui.ins.gradesNote", { count: d.notGraded })}
            </div>
          </div>
          <div
            style={{
              background: "var(--sunk)",
              borderRadius: "var(--radius-card)",
              padding: "12px 14px",
              fontSize: 12,
              lineHeight: 1.55,
              color: "var(--ink-2)",
            }}
          >
            {t("atlas.ui.ins.note")}
          </div>
        </div>
      </div>
    </div>
  );
}
