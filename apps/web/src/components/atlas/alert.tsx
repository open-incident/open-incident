import Link from "next/link";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { atlasActions, incidents, investigations, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { canRespond, currentMember } from "@/lib/session";
import { getServiceAutonomy, type AlertAtlasState } from "@/lib/atlas/queries";
import { atlasAvailable, firstToldOf, ownerTeamOf } from "./data";
import { levelKey } from "./ui";
import { fixName } from "./words";
import { ApproveFix } from "./approve-fix";

/** The guardrails that make Atlas ask a person first — `payload.guardrail` of a waiting action. */
const GUARDRAILS = [
  "firstUseOnService",
  "sev1",
  "securityAndPrivate",
  "changeFreeze",
  "publicStatusPage",
] as const;

const badge: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "var(--viol)",
  background: "var(--viol-t)",
  borderRadius: 5,
  padding: "1px 6px",
  flex: "none",
  whiteSpace: "nowrap",
};

/**
 * "✦ Atlas on it" / "✦ by Atlas alone" / "✦ by Atlas · Thomas told". Feed it
 * alertAtlasStates() once per list; nothing when Atlas has no part in it.
 * Owner: atlas-ui.
 */
export async function AtlasAlertBadge({ state }: { state: AlertAtlasState | undefined }) {
  if (!state) return null;
  const t = await getT();
  const text =
    state.state === "on_it"
      ? t("atlas.ui.alert.onIt")
      : state.state === "told" && state.told
        ? t("atlas.ui.alert.told", { name: state.told.split(" ")[0] ?? state.told })
        : t("atlas.ui.alert.alone");
  return (
    <span data-testid="atlas-alert-badge" data-state={state.state} style={badge}>
      {text}
    </span>
  );
}

/**
 * Alert detail: what Atlas is doing about the incident this alert belongs to,
 * and — when it waits for a person — why it asks ("…has never been used on
 * this service, so Jordan is asked first") with "Approve the fix". Nothing
 * when Atlas is not on it. Owner: atlas-ui.
 */
export async function AtlasAlertBanner({
  tenantId,
  incidentId,
}: {
  tenantId: string;
  alertId: string;
  incidentId: string | null;
}) {
  if (!incidentId || !(await atlasAvailable())) return null;
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({
        number: incidents.number,
        serviceId: incidents.serviceId,
        resolvedAt: incidents.resolvedAt,
        paused: investigations.paused,
      })
      .from(investigations)
      .innerJoin(incidents, eq(incidents.id, investigations.incidentId))
      .where(and(eq(investigations.tenantId, tenantId), eq(investigations.incidentId, incidentId))),
  );
  if (!row || row.resolvedAt || row.paused) return null;
  const [waiting] = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(atlasActions)
      .where(
        and(
          eq(atlasActions.tenantId, tenantId),
          eq(atlasActions.incidentId, incidentId),
          inArray(atlasActions.approvalState, ["waiting"]),
          isNull(atlasActions.undoneAt),
        ),
      )
      .orderBy(asc(atlasActions.at))
      .limit(1),
  );
  const t = await getT();
  const current = await currentMember();
  const autonomy = row.serviceId ? await getServiceAutonomy(tenantId, row.serviceId) : null;
  const level = autonomy?.effective ?? null;
  const at =
    autonomy && level != null
      ? t("atlas.ui.alert.at", {
          service: autonomy.key,
          level,
          name: t(`atlas.ui.level.${levelKey(level)}`),
        })
      : null;

  let body: string;
  if (waiting) {
    // Who is asked: the person a page reached for this incident, else the
    // team that owns the service, else "a person".
    const told = (await firstToldOf(tenantId, [incidentId])).get(incidentId);
    const owner = row.serviceId ? await ownerTeamOf(tenantId, row.serviceId) : null;
    const who = told ? told.name.split(" ")[0]! : (owner ?? t("atlas.ui.alert.aPerson"));
    const hits = Array.isArray(waiting.payload.guardrails) ? waiting.payload.guardrails : [];
    const reasons = Array.isArray(waiting.payload.reasons) ? waiting.payload.reasons : [];
    const guardrail = GUARDRAILS.find((g) => hits.includes(g));
    const reason = guardrail
      ? t(`atlas.ui.alert.reason.${guardrail}`)
      : reasons.includes("challenger")
        ? t("atlas.ui.alert.reason.challenger")
        : reasons.includes("action_level")
          ? t("atlas.ui.alert.reason.actionLevel")
          : null;
    const params = { at: at ?? t("atlas.ui.alert.noService"), fix: fixName(waiting), who };
    body = reason
      ? t("atlas.ui.alert.guarded", { ...params, reason })
      : t("atlas.ui.alert.proposes", params);
  } else {
    body = at ? t("atlas.ui.alert.working", { at }) : t("atlas.ui.alert.workingNoService");
  }

  return (
    <div
      data-testid="atlas-alert-banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        background: "var(--viol-t)",
        borderRadius: 10,
        padding: "9px 12px",
        marginTop: 4,
      }}
    >
      <span style={{ color: "var(--viol)" }}>✦</span>
      <span style={{ flex: "1 1 280px", fontSize: 12.5, lineHeight: 1.5 }}>
        <strong>{t("atlas.ui.alert.lead")}</strong> {body}
      </span>
      {waiting && current && canRespond(current.member) ? (
        <ApproveFix actionId={waiting.id} label={t("atlas.ui.alert.approve")} />
      ) : (
        <Link
          href={`/app/incidents/${row.number}?tab=atlas`}
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--viol)",
            whiteSpace: "nowrap",
            textDecoration: "none",
          }}
        >
          {t("atlas.ui.alert.open")}
        </Link>
      )}
    </div>
  );
}
