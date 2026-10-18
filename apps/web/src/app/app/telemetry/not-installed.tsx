import Link from "next/link";
import { getT } from "@/i18n/server";

/**
 * The screen when there is no column store (design: "Telemetry — module not
 * installed").
 *
 * An instance without ClickHouse cannot show a span, so this says what the
 * module is and how to install it — and never draws an empty chart in the
 * meantime. The design's "Preview the installed module" is a prototype's
 * switch; the product has nothing to preview, so it offers the guide.
 */
export async function NotInstalled({ admin, endpoint }: { admin: boolean; endpoint: string }) {
  const t = await getT();
  const CODE: React.CSSProperties = {
    fontFamily: "var(--mono)",
    fontSize: 11.5,
    background: "var(--sunk)",
    borderRadius: 6,
    padding: "2px 7px",
  };
  const steps = [
    t.parts("tel2.install1", "code"),
    t.parts("tel2.install2", "code"),
    t.parts("tel2.install3", "code"),
  ];
  const codes = ["docker compose --profile telemetry up -d", endpoint, "service.name"];

  return (
    <div
      style={{ maxWidth: 1200, margin: "0 auto", padding: "22px 28px 60px" }}
      data-screen-label="Telemetry"
    >
      <div
        data-testid="telemetry-not-installed"
        data-screen-label="Telemetry — module not installed"
        style={{
          maxWidth: 720,
          margin: "60px auto 0",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          animation: "oi-rise .2s ease backwards",
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
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.6,
              color: "var(--ink-2)",
              textWrap: "pretty",
            }}
          >
            {t("telemetry.notInstalledBody")}
          </p>
        </div>

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
            }}
          >
            {steps.map(([before, after], i) => (
              <div key={i} style={{ display: "contents" }}>
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
                <span>
                  {before}
                  <code style={CODE}>{codes[i]}</code>
                  {after}
                </span>
              </div>
            ))}
          </div>
          {!admin && (
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("tel2.installAdmin")}</div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Link
              href="/app/docs/telemetry"
              className="oi-hover-brand-2"
              style={{
                height: 34,
                padding: "0 14px",
                borderRadius: 9,
                background: "var(--brand)",
                color: "var(--on-brand)",
                display: "flex",
                alignItems: "center",
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {t("tel2.readGuide")}
            </Link>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", textAlign: "center" }}>
          {t("tel2.installFoot")}
        </div>
      </div>
    </div>
  );
}
