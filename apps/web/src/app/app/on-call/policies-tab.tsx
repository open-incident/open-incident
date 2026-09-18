import Link from "next/link";
import { eq } from "drizzle-orm";
import { monitors, services, teams, withTenant, type EscalationNode } from "@openincident/db";
import { isManagerRole } from "@openincident/config";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { listPaths } from "@/lib/oncall";
import { levelTargets, loadNameSource, mainChain, namesOf, type Names } from "./policy";
import { NewPathDialog } from "./paths/dialogs";
import { testPath } from "./paths/actions";

const GHOST: React.CSSProperties = {
  height: 28,
  padding: "0 11px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  display: "flex",
  alignItems: "center",
  fontSize: 12,
  fontWeight: 600,
  color: "inherit",
  textDecoration: "none",
  cursor: "pointer",
};

/** The dot of a step: the further down the policy, the graver the colour. */
function toneOf(node: EscalationNode, levelIndex: number): string {
  if (node.kind === "condition") return "var(--wait)";
  if (node.kind === "delay") return "var(--ink-3)";
  if (node.kind === "retry") return "var(--viol)";
  if (node.kind === "reassign") return "var(--brand)";
  return levelIndex === 0 ? "var(--dang)" : levelIndex === 1 ? "var(--wait)" : "var(--viol)";
}

/**
 * On-call · Policies — each escalation policy read as a timeline: what happens
 * now, what happens if nobody acknowledged, and how long each step waits.
 *
 * The drawing walks the real graph — the same walk the engine takes — so a
 * condition, a delay or a hand-over to another policy shows up as a step
 * rather than quietly disappearing from the picture.
 */
export async function PoliciesTab() {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const manages = isManagerRole(member);
  const data = await withTenant(tenant.id, async (tx) => {
    const paths = await listPaths(tx, tenant.id);
    const source = await loadNameSource(
      tx,
      tenant.id,
      paths.map((p) => p.graph),
      new Map(),
    );
    return {
      paths,
      names: namesOf(source),
      teams: await tx
        .select({ id: teams.id, name: teams.name, policyPathId: teams.policyPathId })
        .from(teams)
        .where(eq(teams.tenantId, tenant.id)),
      services: await tx
        .select({ id: services.id, ownerTeamId: services.ownerTeamId })
        .from(services)
        .where(eq(services.tenantId, tenant.id)),
      monitors: await tx
        .select({ id: monitors.id, serviceId: monitors.serviceId })
        .from(monitors)
        .where(eq(monitors.tenantId, tenant.id)),
    };
  });
  const names: Names = data.names;

  /** What this policy is on the hook for, said in the product's own units. */
  const usedBy = (pathId: string, routeCount: number) => {
    const owners = data.teams.filter((x) => x.policyPathId === pathId);
    const owned = data.services.filter(
      (s) => s.ownerTeamId && owners.some((o) => o.id === s.ownerTeamId),
    );
    const watched = data.monitors.filter(
      (m) => m.serviceId && owned.some((s) => s.id === m.serviceId),
    );
    const parts = [
      ...owners.map((o) => t("oc2.pol.usedTeam", { name: o.name })),
      ...(routeCount ? [t("oc2.pol.usedRoutes", { count: routeCount })] : []),
      ...(owned.length ? [t("oc2.pol.usedServices", { count: owned.length })] : []),
      ...(watched.length ? [t("oc2.pol.usedMonitors", { count: watched.length })] : []),
    ];
    return parts.length ? parts.join(t("oc2.sep")) : t("oc2.pol.usedNone");
  };

  const sentence = (node: EscalationNode, levelIndex: number): string => {
    if (node.kind === "level") {
      const target = levelTargets(t, node, names);
      return levelIndex === 0
        ? t("oc2.pol.stepFirst", { target })
        : levelIndex === 1
          ? t("oc2.pol.stepThen", { target })
          : t("oc2.pol.stepStill", { target });
    }
    if (node.kind === "delay")
      return node.untilWorkingHoursSetId
        ? t("oc2.pol.stepDelayUntil", { set: names.workingHours(node.untilWorkingHoursSetId) })
        : t("oc2.pol.stepDelay", { count: node.minutes ?? 0 });
    if (node.kind === "retry")
      return t("oc2.pol.stepRetry", { count: node.maxLoops, interval: node.intervalMinutes });
    if (node.kind === "reassign")
      return t("oc2.pol.stepReassign", { path: names.path(node.pathId) });
    const test =
      node.test.type === "working_hours"
        ? t("oc2.pol.condHours", { set: names.workingHours(node.test.setId) })
        : node.test.type === "priority"
          ? t("oc2.pol.condPriority", { rank: String(node.test.maxRank + 1) })
          : t("oc2.pol.condUrgency", {
              urgency: t(
                node.test.urgency === "high" ? "oc2.pol.urgencyHigh" : "oc2.pol.urgencyLow",
              ),
            });
    return t("oc2.pol.stepCondition", { test });
  };

  const chipsOf = (node: EscalationNode): string[] => {
    if (node.kind === "level")
      return [
        t(node.urgency === "high" ? "oc2.pol.chipWakes" : "oc2.pol.chipSilent"),
        t("oc2.pol.chipAck", { count: node.ackTimeoutMinutes }),
        ...(node.retries > 0
          ? [t("oc2.pol.chipRetry", { count: node.retries, interval: node.retryIntervalMinutes })]
          : []),
        ...(node.everyoneMustAck ? [t("oc2.pol.chipAllAck")] : []),
        ...(node.roundRobin ? [t("oc2.pol.chipRoundRobin")] : []),
      ];
    if (node.kind === "condition") return [t("oc2.pol.condElse")];
    return [];
  };

  return (
    <div
      className="oi-rise-fast"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 320px",
        gap: 14,
        alignItems: "start",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {data.paths.length === 0 && (
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-card)",
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 14.5, fontWeight: 700 }}>{t("oc2.pol.none")}</span>
            <span style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              {t("oc2.pol.noneNote")}
            </span>
          </div>
        )}
        {data.paths.map((entry) => {
          const chain = mainChain(entry.graph);
          let levelIndex = -1;
          return (
            <div
              key={entry.path.id}
              style={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-card)",
                boxShadow: "var(--shadow-card)",
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14.5, fontWeight: 700 }}>{entry.path.name}</span>
                <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                  {usedBy(entry.path.id, entry.routes.length)}
                </span>
                {entry.hasDraft && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      background: "var(--wait-t)",
                      color: "var(--wait)",
                      borderRadius: 999,
                      padding: "2px 8px",
                    }}
                  >
                    {t("oc2.pol.draft")}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <form action={testPath}>
                  <input type="hidden" name="pathId" value={entry.path.id} />
                  <button type="submit" data-testid="path-test" className="oi-hover" style={GHOST}>
                    {t("oc2.pol.test")}
                  </button>
                </form>
                {manages && (
                  <Link
                    href={`/app/on-call/paths?path=${entry.path.id}`}
                    className="oi-hover"
                    style={GHOST}
                  >
                    {t("oc2.pol.edit")}
                  </Link>
                )}
              </div>

              {chain.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("oc2.pol.empty")}</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {chain.map(({ node, offset }) => {
                    if (node.kind === "level") levelIndex += 1;
                    const chips = chipsOf(node);
                    return (
                      <div
                        key={node.id}
                        data-testid={node.kind === "level" ? "path-level" : "path-step"}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "64px 20px minmax(0, 1fr)",
                          gap: 10,
                          alignItems: "start",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 11,
                            color: "var(--ink-3)",
                            textAlign: "right",
                            paddingTop: 9,
                          }}
                        >
                          {offset === 0 ? t("oc2.pol.now") : t("oc2.pol.after", { count: offset })}
                        </span>
                        <span
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            paddingTop: 9,
                          }}
                        >
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              background: toneOf(node, levelIndex),
                              flex: "none",
                            }}
                          />
                          <span
                            style={{
                              width: 1.5,
                              flex: 1,
                              minHeight: 22,
                              background: "var(--line-2)",
                            }}
                          />
                        </span>
                        <div
                          style={{
                            padding: "6px 0 12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 3,
                          }}
                        >
                          <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>
                            {sentence(node, levelIndex)}
                          </div>
                          {chips.length > 0 && (
                            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                              {chips.map((c) => (
                                <span
                                  key={c}
                                  style={{
                                    fontSize: 10.5,
                                    fontWeight: 600,
                                    background: "var(--sunk)",
                                    color: "var(--ink-2)",
                                    borderRadius: 999,
                                    padding: "2px 8px",
                                  }}
                                >
                                  {c}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div
                style={{
                  fontSize: 12,
                  color: "var(--ink-3)",
                  borderTop: "1px solid var(--line-2)",
                  paddingTop: 9,
                }}
              >
                {t("oc2.pol.firstAck")}{" "}
                {manages && (
                  <Link
                    href={`/app/on-call/paths?path=${entry.path.id}`}
                    style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}
                  >
                    {t("oc2.pol.advanced")}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {manages && (
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-card)",
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("oc2.pol.newTitle")}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              {t("oc2.pol.newNote")}
            </div>
            <NewPathDialog />
          </div>
        )}
        <div
          style={{
            background: "var(--sunk)",
            borderRadius: "var(--radius-card)",
            padding: "13px 15px",
            fontSize: 12.5,
            color: "var(--ink-2)",
            lineHeight: 1.55,
          }}
        >
          {t("oc2.pol.ownerNote")}
        </div>
      </div>
    </div>
  );
}
