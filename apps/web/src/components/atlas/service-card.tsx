import Link from "next/link";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { incidents, investigations, services, teams, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { getServiceAutonomy } from "@/lib/atlas/queries";
import { progressToNext } from "@/lib/atlas/levels";
import { atlasAvailable } from "./data";
import { LevelBar, levelKey, TONE } from "./ui";
import { criterionLine } from "./words";

const GRADE_TONE = {
  bullseye: TONE.ok,
  on_target: TONE.ok,
  miss: TONE.wait,
  nowhere_near: TONE.dang,
} as const;

/**
 * "✦ Atlas on this service": the level and its five-segment bar (the next
 * segment fills with the progress toward it), what the level means and what
 * the next one would change, the next level's criteria with ✓ / …, and the
 * last graded runs. A link to Settings › Atlas, where an admin may cap it.
 * Nothing when Atlas is not available on the instance. Owner: atlas-ui.
 */
export async function ServiceAtlasCard({
  tenantId,
  serviceId,
}: {
  tenantId: string;
  serviceId: string;
}) {
  if (!(await atlasAvailable())) return null;
  const a = await getServiceAutonomy(tenantId, serviceId);
  if (!a) return null;
  const t = await getT();
  const [[owner], graded] = await withTenant(tenantId, (tx) =>
    Promise.all([
      tx
        .select({ name: teams.name })
        .from(services)
        .innerJoin(teams, eq(teams.id, services.ownerTeamId))
        .where(and(eq(services.tenantId, tenantId), eq(services.id, serviceId))),
      tx
        .select({ number: incidents.number, grade: investigations.grade })
        .from(investigations)
        .innerJoin(incidents, eq(incidents.id, investigations.incidentId))
        .where(
          and(
            eq(investigations.tenantId, tenantId),
            eq(incidents.serviceId, serviceId),
            isNotNull(investigations.grade),
          ),
        )
        .orderBy(desc(investigations.gradedAt))
        .limit(3),
    ]),
  );
  const level = a.effective;
  const next = a.next.next;
  const criteria = a.next.criteria;
  // Progress toward the next level: the ladder's own measure of it.
  const progress = next ? progressToNext(a) : null;
  const ownerName = owner?.name ?? t("atlas.ui.svc.theOwner");
  const [nowBefore, nowAfter] = next
    ? t.parts(`atlas.ui.svc.now.${levelKey(level)}`, "next", { owner: ownerName })
    : [t(`atlas.ui.svc.now.${levelKey(level)}`, { owner: ownerName, next: "" }), ""];

  return (
    <div
      data-testid="atlas-service-card"
      style={{
        background: "var(--panel)",
        border: "1px solid var(--viol)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 11,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: "var(--viol)" }}>✦</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("atlas.ui.svc.title")}</span>
        <span
          data-testid="atlas-service-level"
          style={{
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 999,
            padding: "2px 9px",
            background: "var(--viol-t)",
            color: "var(--viol)",
          }}
        >
          {t("atlas.ui.levelShort", { level, name: t(`atlas.ui.level.${levelKey(level)}`) })}
        </span>
        <span style={{ flex: 1 }} />
        <Link
          href="/app/settings/ai"
          style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}
        >
          {t("atlas.ui.svc.settings")}
        </Link>
      </div>
      <LevelBar level={level} progress={progress} />
      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
        {nowBefore}
        {next && (
          <strong>
            {t("atlas.ui.levelShort", {
              level: next.level,
              name: t(`atlas.ui.level.${next.key}`),
            })}
          </strong>
        )}
        {nowAfter}
        {a.cap != null && a.cap < a.level ? ` ${t("atlas.ui.svc.capped", { level: a.cap })}` : ""}
      </div>
      {criteria.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
            gap: 6,
          }}
        >
          {criteria.map((c) => (
            <div
              key={c.key}
              data-testid="atlas-service-criterion"
              data-met={c.met ? "1" : "0"}
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
            >
              <span
                aria-hidden
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: c.met ? "var(--ok-t)" : "var(--wait-t)",
                  color: c.met ? "var(--ok)" : "var(--wait)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 9,
                  fontWeight: 800,
                  flex: "none",
                }}
              >
                {c.met ? "✓" : "…"}
              </span>
              {criterionLine(t, c)}
            </div>
          ))}
        </div>
      )}
      {graded.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            borderTop: "1px solid var(--line-2)",
            paddingTop: 9,
          }}
        >
          <span style={{ fontSize: 11, color: "var(--ink-3)", marginRight: 4 }}>
            {t("atlas.ui.svc.lastRuns")}
          </span>
          {graded.map((g) => {
            const tone = GRADE_TONE[g.grade!];
            return (
              <Link
                key={g.number}
                href={`/app/incidents/${g.number}?tab=atlas`}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 999,
                  padding: "1px 8px",
                  background: tone.bg,
                  color: tone.ink,
                  textDecoration: "none",
                }}
              >
                INC-{g.number} · {t(`ai.investigation.grade.${g.grade!}`)}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
