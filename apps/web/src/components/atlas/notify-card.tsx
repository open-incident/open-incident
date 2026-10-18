import { getT } from "@/i18n/server";
import { getNotifyMode } from "@/lib/atlas/queries";
import { atlasAvailable } from "./data";
import { NotifyChoice } from "./notify-choice";

/**
 * My notifications › "When Atlas resolves on its own": a silent push right
 * away, a summary at 09:00 (the default), or nothing — each member for
 * themselves, stored at once. Nothing when Atlas is not there. Owner: atlas-ui.
 */
export async function AtlasNotifyCard({
  tenantId,
  memberId,
}: {
  tenantId: string;
  memberId: string;
}) {
  if (!(await atlasAvailable())) return null;
  const [t, mode] = await Promise.all([getT(), getNotifyMode(tenantId, memberId)]);
  return (
    <div
      data-testid="atlas-notify-card"
      style={{
        background: "var(--panel)",
        border: "1px solid var(--viol)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--viol)" }}>✦</span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{t("atlas.ui.notify.title")}</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
        {t("atlas.ui.notify.lead")}
      </div>
      <NotifyChoice
        mode={mode}
        options={(["push", "summary", "nothing"] as const).map((id) => ({
          id,
          label: t(`atlas.ui.notify.${id}`),
          hint: t(`atlas.ui.notify.${id}Hint`),
        }))}
      />
      <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("atlas.ui.notify.l3")}</div>
    </div>
  );
}
