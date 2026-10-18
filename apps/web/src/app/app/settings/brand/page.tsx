import { and, desc, eq } from "drizzle-orm";
import { incidentStatuses, incidents, withTenant } from "@openincident/db";
import { storageConfigured } from "@openincident/storage";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { Card, Note, SettingsPage } from "@/components/settings/template";
import { SettingsForm } from "@/components/settings/settings-form";
import { AccentPicker, LogoTile, RemoveLogos } from "./brand-parts";
import { saveBrand } from "./logo-actions";

/**
 * Settings › Brand (design V2): the two logos — on a light and on a dark
 * background — the accent colour, and a preview of what customers see with
 * them: the status page's header and an incident email.
 *
 * A logo is sent the moment it is picked; the accent waits for the save bar.
 * Without object storage the upload is not offered and the note says why;
 * every screen then shows the initial on the accent.
 */
export default async function BrandPage() {
  const { tenant, workspace, member } = await requireMember();
  const t = await getT();
  const storage = storageConfigured();
  const manages = isManager(member);
  const b = workspace.branding;
  const saved = (b.accentColor ?? "#0B4A6F").toUpperCase();
  const accent = `var(--oi-brand-preview, ${saved})`;
  const initial = workspace.name.charAt(0).toUpperCase() || "—";

  // The email preview tells of the workspace's latest incident, as its subscribers read it.
  const latest = await withTenant(tenant.id, async (tx) => {
    const [row] = await tx
      .select({
        number: incidents.number,
        name: incidents.name,
        phase: incidents.phase,
        status: incidentStatuses.name,
      })
      .from(incidents)
      .leftJoin(incidentStatuses, eq(incidentStatuses.id, incidents.statusId))
      .where(and(eq(incidents.tenantId, tenant.id), eq(incidents.visibility, "public")))
      .orderBy(desc(incidents.declaredAt))
      .limit(1);
    return row ?? null;
  });
  const phaseLabel = (p: string) =>
    t(`incident.phase.${p as "triage" | "active" | "post_incident" | "closed"}`);

  const h: React.CSSProperties = { fontSize: 14, fontWeight: 600 };
  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.workspace")}
      title={t("settingsV2.entry.brand")}
      lead={t("settingsV2.brand.lead")}
      testId="settings-brand"
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
          gap: 12,
        }}
      >
        <Card>
          <div style={h}>{t("settingsV2.brand.logo")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {(["light", "dark"] as const).map((v) => (
              <LogoTile
                key={v}
                variant={v}
                initial={initial}
                saved={saved}
                logoUrl={b.logoKey ? (b.logoUrl ?? null) : null}
                storage={storage}
                canManage={manages}
              />
            ))}
          </div>
          {manages && b.logoKey && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <RemoveLogos />
            </div>
          )}
          <div style={{ ...h, marginTop: 4 }}>{t("settingsV2.brand.accent")}</div>
          <SettingsForm action={saveBrand} testId="brand-form" style={{ gap: 12 }}>
            <AccentPicker initial={saved} label={t("settingsV2.brand.accentLabel")} />
          </SettingsForm>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
            {t("settingsV2.brand.accentWhere")}
          </div>
        </Card>

        <Card>
          <div style={h}>{t("settingsV2.brand.preview")}</div>
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ height: 4, background: accent }} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                background: "#FAFAF7",
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  background: accent,
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                {initial}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1B1917" }}>
                {t("settingsV2.brand.statusName", { workspace: workspace.name })}
              </span>
              <span style={{ flex: 1 }} />
              <span
                style={{
                  height: 28,
                  padding: "0 11px",
                  borderRadius: 8,
                  background: accent,
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {t("settingsV2.brand.subscribe")}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                background: "#FAFAF7",
                borderTop: "1px solid #EDEAE3",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#2E9E6B" }} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "#1B1917" }}>
                {t("settingsV2.brand.operational")}
              </span>
            </div>
          </div>
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
            <div
              style={{
                padding: "10px 14px",
                background: accent,
                color: "#fff",
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              {t("settingsV2.brand.mailHead", { workspace: workspace.name })}
            </div>
            <div
              style={{
                padding: "12px 14px",
                fontSize: 12.5,
                lineHeight: 1.55,
                color: "var(--ink-2)",
              }}
            >
              {latest
                ? t("settingsV2.brand.mailBody", {
                    ref: `INC-${latest.number}`,
                    title: latest.name,
                    status: latest.status ?? phaseLabel(latest.phase),
                  })
                : t("settingsV2.brand.mailEmpty")}
            </div>
          </div>
        </Card>
      </div>
      <Note>{t("settingsV2.brand.storageNote")}</Note>
    </SettingsPage>
  );
}
