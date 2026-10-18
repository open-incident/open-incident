import Link from "next/link";
import { getT } from "@/i18n/server";
import { RISE, cardStyle } from "@/components/settings/template";
import { settingsDirectory } from "./directory";

/**
 * Settings — the overview (design V2): who and where you are, what needs
 * somebody now, then one card per group with every screen and the line that
 * says where it stands. Every line is read from the workspace's rows — a
 * warning shown here is a fact, and nothing shows when nothing is wrong.
 */
export default async function SettingsOverview() {
  const t = await getT();
  const dir = await settingsDirectory();
  const toneColor = (tone: "wait" | "dang" | "mute") =>
    tone === "dang" ? "var(--dang)" : tone === "wait" ? "var(--wait)" : "var(--ink-3)";

  return (
    <div
      data-screen-label="Settings — overview"
      data-testid="settings-overview"
      style={{ display: "flex", flexDirection: "column", gap: 18, animation: RISE }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: "-.02em",
          }}
        >
          {t("settingsV2.overview.title")}
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>
          {t("settingsV2.overview.sub", {
            workspace: dir.workspaceName,
            edition: dir.cloud
              ? t("settingsV2.overview.cloud")
              : t("settingsV2.overview.selfHosted"),
            role: t(`settingsV2.overview.role.${dir.role}`),
          })}
        </p>
      </div>

      {dir.attention.length > 0 && (
        <section data-testid="settings-attention" style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("settingsV2.attention.title")}</span>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                fontWeight: 600,
                background: "var(--wait-t)",
                color: "var(--wait)",
                borderRadius: 999,
                padding: "1px 8px",
              }}
            >
              {dir.attention.length}
            </span>
          </div>
          {dir.attention.map((a, i) => (
            <Link
              key={i}
              href={a.href}
              data-testid="settings-attention-item"
              className="oi-hover"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 18px",
                borderTop: "1px solid var(--line-2)",
                cursor: "pointer",
                flexWrap: "wrap",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: toneColor(a.tone),
                  flex: "none",
                }}
              />
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.title}</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 1 }}>{a.sub}</div>
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--brand)",
                  whiteSpace: "nowrap",
                }}
              >
                {t("settingsV2.attention.where", { where: a.where })}
              </span>
            </Link>
          ))}
        </section>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
          gap: 12,
        }}
      >
        {dir.groups.map((g) => (
          <section
            key={g.key}
            data-testid={`settings-group-${g.key}`}
            style={{
              ...cardStyle,
              overflow: "visible",
              padding: "14px 8px 8px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "0 10px" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{g.title}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", margin: "2px 0 8px" }}>
                {g.desc}
              </div>
            </div>
            {g.entries.map((e) => (
              <Link
                key={e.key}
                href={e.href}
                className="oi-hover"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: 9,
                  cursor: "pointer",
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" }}>
                  {e.label}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12,
                    color: e.tone ? toneColor(e.tone) : "var(--ink-3)",
                    textAlign: "right",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {e.status}
                </span>
                <span style={{ color: "var(--ink-3)", fontSize: 12 }}>›</span>
              </Link>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
