import { redirect } from "next/navigation";
import { getTenantBySlug } from "@openincident/db";
import { originFor } from "@openincident/config";
import { getT } from "@/i18n/server";
import { getTenantFromHeaders } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * The direct install URL the Slack Marketplace sends people to.
 *
 * An installation started from the Marketplace knows nothing of us: no
 * workspace, no session. On a workspace's own host this page hands over to
 * the authorization step (which asks to sign in first if needed and comes
 * back). On the bare domain it asks which workspace, then goes there.
 */
async function goToWorkspace(formData: FormData) {
  "use server";
  const slug = String(formData.get("slug") ?? "")
    .trim()
    .toLowerCase()
    .replace(/\..*$/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) redirect("/install/slack?error=slug");
  const tenant = await getTenantBySlug(slug).catch(() => null);
  if (!tenant) redirect("/install/slack?error=unknown");
  const base = process.env.BASE_DOMAIN ?? "localhost:3100";
  const host = tenant.customDomain ?? `${slug}.${base}`;
  redirect(`${originFor(host)}/install/slack`);
}

export default async function SlackInstall({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const tenant = await getTenantFromHeaders().catch(() => null);
  if (tenant) redirect("/api/slack/oauth/start");
  const t = await getT();
  const { error } = await searchParams;
  const base = process.env.BASE_DOMAIN ?? "localhost:3100";
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
      <form
        action={goToWorkspace}
        data-testid="slack-install-form"
        className="oi-panel"
        style={{ width: 420, padding: 28, display: "flex", flexDirection: "column", gap: 14 }}
      >
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("slackInstall.title")}
        </h1>
        <p className="oi-lead">{t("slackInstall.lead")}</p>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="oi-label">{t("slackInstall.workspace")}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              name="slug"
              required
              autoFocus
              placeholder="acme"
              className="oi-control oi-field"
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 13, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
              .{base}
            </span>
          </span>
        </label>
        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--dang)" }}>
            {error === "unknown" ? t("slackInstall.unknown") : t("slackInstall.badSlug")}
          </p>
        )}
        <button type="submit" className="oi-btn oi-btn-primary" style={{ alignSelf: "flex-start" }}>
          {t("slackInstall.continue")}
        </button>
      </form>
    </main>
  );
}
