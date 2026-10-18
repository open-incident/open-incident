import { getT } from "@/i18n/server";
import { getAtlasSettings, listServiceAutonomy } from "@/lib/atlas/queries";
import { atlasAvailable } from "./data";

/**
 * First step of an escalation policy: "✦ Atlas tries first", with the level
 * of each service the policy pages for. It is drawn like the policy's own
 * steps (time, dot on the rail, sentence, chips). Nothing when Atlas is not
 * there, is stopped everywhere, or only observes on every one of these
 * services — then the policy really does start with a person. Owner: atlas-ui.
 */
export async function AtlasPolicyStep({
  tenantId,
  serviceIds,
}: {
  tenantId: string;
  serviceIds: string[];
}) {
  if (serviceIds.length === 0 || !(await atlasAvailable())) return null;
  const [settings, all] = await Promise.all([
    getAtlasSettings(tenantId),
    listServiceAutonomy(tenantId),
  ]);
  if (settings?.killSwitch) return null;
  const want = new Set(serviceIds);
  const mine = all.filter((s) => want.has(s.serviceId)).sort((a, b) => b.effective - a.effective);
  if (!mine.some((s) => s.effective >= 1)) return null;
  const t = await getT();
  return (
    <div
      data-testid="atlas-policy-step"
      style={{
        display: "grid",
        gridTemplateColumns: "64px 20px minmax(0,1fr)",
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
        {t("atlas.ui.policy.now")}
      </span>
      <span
        aria-hidden
        style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 9 }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "var(--viol)",
            flex: "none",
          }}
        />
        <span style={{ width: 1.5, flex: 1, minHeight: 22, background: "var(--line-2)" }} />
      </span>
      <div style={{ padding: "6px 0 12px", display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>{t("atlas.ui.policy.step")}</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {mine.map((s) => (
            <span
              key={s.serviceId}
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                background: "var(--sunk)",
                color: "var(--ink-2)",
                borderRadius: 999,
                padding: "2px 8px",
              }}
            >
              {t("atlas.ui.policy.chip", { service: s.key, level: s.effective })}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The explainer beside the policies: what "Atlas tries first" means at each
 * level. Nothing when Atlas is not there or is stopped everywhere. Owner: atlas-ui.
 */
export async function AtlasPolicyExplainer({ tenantId }: { tenantId: string }) {
  if (!(await atlasAvailable())) return null;
  const settings = await getAtlasSettings(tenantId);
  if (settings?.killSwitch) return null;
  const t = await getT();
  return (
    <div
      data-testid="atlas-policy-explainer"
      style={{
        background: "var(--viol-t)",
        borderRadius: "var(--radius-card)",
        padding: "13px 15px",
        fontSize: 12.5,
        color: "var(--ink)",
        lineHeight: 1.55,
      }}
    >
      <strong style={{ color: "var(--viol)" }}>{t("atlas.ui.policy.lead")}</strong>{" "}
      {t("atlas.ui.policy.explainer")}
    </div>
  );
}
