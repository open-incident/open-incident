import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { requireTenant } from "@/lib/tenant";
import { otlpEndpoints, telemetryInstalled } from "@/lib/telemetry-module";

/**
 * Telemetry — logs, traces and metrics, when the module is installed.
 *
 * Until it is, this screen says so and says how, rather than drawing empty
 * charts: an instance without a ClickHouse cannot show a span, and pretending
 * it can is the one thing the product refuses to do.
 */
export default async function TelemetryPage() {
  const { member } = await requireMember();
  const tenant = await requireTenant();
  const t = await getT();
  const installed = telemetryInstalled();
  const endpoints = otlpEndpoints(tenant.customDomain ?? `${tenant.slug}.example`);
  const admin = member.role === "owner" || member.role === "admin";

  if (installed) {
    // The module is present: its screens land with the telemetry milestone.
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "22px 28px 60px" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t("nav.telemetry")}
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6, marginTop: 10 }}>
          {t("telemetry.receiving")}
        </p>
      </div>
    );
  }

  const steps = [
    t("telemetry.step1"),
    t("telemetry.step2", { endpoint: endpoints.grpc }),
    t("telemetry.step3"),
  ];

  return (
    <div
      className="oi-rise"
      style={{
        maxWidth: 720,
        margin: "60px auto 0",
        padding: "0 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 12,
        }}
      >
        <span
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: "var(--wait-t)",
            color: "var(--wait)",
            display: "grid",
            placeItems: "center",
            fontSize: 22,
          }}
        >
          ◌
        </span>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t("telemetry.notInstalledTitle")}
        </h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--ink-2)" }}>
          {t("telemetry.notInstalledBody")}
        </p>
      </div>

      {admin && (
        <div
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
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>
            {t("telemetry.installTitle")}{" "}
            <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>
              {t("telemetry.installMeta")}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "24px minmax(0,1fr)",
              gap: 10,
              fontSize: 13,
              lineHeight: 1.55,
              alignItems: "start",
            }}
          >
            {steps.map((s, i) => (
              <div key={s} style={{ display: "contents" }}>
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "var(--sunk)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {i + 1}
                </span>
                <span>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--ink-3)", textAlign: "center" }}>
        {t("telemetry.footnote")}
      </div>
    </div>
  );
}
