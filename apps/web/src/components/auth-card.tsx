import type { ReactNode } from "react";
import { headers } from "next/headers";
import { getT } from "@/i18n/server";
import { requireWorkspace } from "@/lib/tenant";
import { WorkspaceMark } from "@/components/shell/mark";

/**
 * The workspace-branded frame that /login, /forgot-password, /reset-password
 * and /invite share: a brand-tinted gradient, a 400 px column, the workspace
 * identity above a radius-16 card carrying the design's `--shadow-login`.
 *
 * requireWorkspace is called here: these pages render to anonymous visitors, so
 * an invented subdomain must 404 rather than show a branded form.
 */
export async function AuthCard({
  children,
  banner,
  title,
  subtitle,
}: {
  children: ReactNode;
  banner?: ReactNode;
  title?: string;
  subtitle?: string;
}) {
  const t = await getT();
  const { workspace } = await requireWorkspace();
  const host = (await headers()).get("host") ?? "";

  return (
    <main
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100vh",
        padding: 40,
        background: "linear-gradient(180deg, var(--brand-t) 0%, var(--canvas) 55%)",
      }}
    >
      <div
        className="oi-rise-modal"
        style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: 400, gap: 18 }}
      >
        {banner}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <WorkspaceMark name={workspace.name} accent={workspace.branding.accentColor} size={40} />
          <h1
            style={{
              margin: 0,
              textAlign: "center",
              fontFamily: "var(--font-title)",
              fontSize: 21,
              fontWeight: 600,
              letterSpacing: "-.015em",
            }}
          >
            {title ?? workspace.name}
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-3)", textAlign: "center" }}>
            {subtitle ?? host}
          </p>
        </div>
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 16,
            padding: 24,
            boxShadow: "var(--shadow-login)",
          }}
        >
          {children}
        </div>
        <p style={{ margin: 0, textAlign: "center", color: "var(--ink-3)", fontSize: 12.5 }}>
          {t("auth.poweredBy", { product: "Open Incident" })}
        </p>
      </div>
    </main>
  );
}
