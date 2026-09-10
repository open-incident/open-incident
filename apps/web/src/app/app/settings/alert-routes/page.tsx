import Link from "next/link";
import { eq } from "drizzle-orm";
import { alertRoutes, alertSources, escalationPaths, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { describeRoute } from "@/lib/route-summary";
import { deleteRoute, duplicateRoute, moveRoute, toggleRoute } from "./actions";

const btn: React.CSSProperties = {
  height: 30,
  padding: "0 11px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  color: "inherit",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};
const icon: React.CSSProperties = {
  ...btn,
  width: 28,
  padding: 0,
  justifyContent: "center",
  color: "var(--ink-3)",
};

/**
 * Alert routes, in the order they are tried: the first whose conditions hold
 * decides. Each card says what it catches and what it does, in words; the
 * arrows change the order; the editor is a page of its own.
 */
export default async function AlertRoutesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { saved, error } = await searchParams;
  const manages = isManager(member);
  const data = await withTenant(tenant.id, async (tx) => ({
    routes: await tx
      .select()
      .from(alertRoutes)
      .where(eq(alertRoutes.tenantId, tenant.id))
      .orderBy(alertRoutes.position, alertRoutes.createdAt),
    paths: await tx
      .select({
        id: escalationPaths.id,
        name: escalationPaths.name,
        current: escalationPaths.currentVersionId,
      })
      .from(escalationPaths)
      .where(eq(escalationPaths.tenantId, tenant.id)),
    sources: await tx
      .select({ id: alertSources.id, name: alertSources.name })
      .from(alertSources)
      .where(eq(alertSources.tenantId, tenant.id)),
  }));
  const unpublished = (r: (typeof data.routes)[number]) =>
    r.escalations.some((e) => {
      const id = e.kind === "path" ? e.pathId : e.fallbackPathId;
      const p = id ? data.paths.find((x) => x.id === id) : null;
      return id && (!p || !p.current);
    });

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 980 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.routes.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("settings.routes.subtitle")}
        </span>
        <span style={{ flex: 1 }} />
        {saved && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        {error && (
          <span role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}>
            {t("settings.fields.errorInvalid")}
          </span>
        )}
        {manages && (
          <Link
            href="/app/settings/alert-routes/new"
            style={{
              ...btn,
              height: 32,
              background: "var(--brand)",
              borderColor: "var(--brand)",
              color: "#fff",
            }}
            data-testid="route-new"
          >
            {t("settings.routes.new")}
          </Link>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
        {t("settings.routes.orderNote")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.routes.length === 0 && (
          <div
            className="oi-panel"
            style={{ padding: "22px 18px", color: "var(--ink-3)", fontSize: 13 }}
          >
            {t("settings.routes.empty")}
          </div>
        )}
        {data.routes.map((r, i) => {
          const d = describeRoute(r, t, { paths: data.paths, sources: data.sources });
          const warn = unpublished(r);
          return (
            <div
              key={r.id}
              data-testid="route-row"
              className="oi-panel"
              style={{
                display: "flex",
                gap: 12,
                padding: "12px 14px",
                alignItems: "flex-start",
                opacity: r.active ? 1 : 0.6,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  alignItems: "center",
                  flex: "none",
                }}
              >
                <span
                  style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--ink-3)" }}
                >
                  {i + 1}
                </span>
                {manages && (
                  <>
                    <form action={moveRoute}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="dir" value="up" />
                      <button
                        type="submit"
                        disabled={i === 0}
                        style={{ ...icon, height: 24, width: 24 }}
                        aria-label={t("postMortem.moveUp")}
                      >
                        ↑
                      </button>
                    </form>
                    <form action={moveRoute}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="dir" value="down" />
                      <button
                        type="submit"
                        disabled={i === data.routes.length - 1}
                        style={{ ...icon, height: 24, width: 24 }}
                        aria-label={t("postMortem.moveDown")}
                      >
                        ↓
                      </button>
                    </form>
                  </>
                )}
              </div>
              <div
                style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Link
                    href={`/app/settings/alert-routes/${r.id}`}
                    style={{
                      fontWeight: 600,
                      fontSize: 14,
                      color: "inherit",
                      textDecoration: "none",
                    }}
                  >
                    {r.name}
                  </Link>
                  {!r.active && (
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-3)" }}>
                      {t("settings.routes.inactive")}
                    </span>
                  )}
                  {r.testMode && (
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: "var(--wait)",
                        background: "var(--wait-t)",
                        padding: "1px 7px",
                        borderRadius: 999,
                      }}
                    >
                      {t("settings.routes.testMode")}
                    </span>
                  )}
                  {warn && (
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: "var(--dang)",
                        background: "var(--dang-t)",
                        padding: "1px 7px",
                        borderRadius: 999,
                      }}
                    >
                      {t("settings.routes.unpublishedPath")}
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                    }}
                  >
                    {t("settings.routes.alertCount", { count: r.alertCount })}
                  </span>
                </div>
                {r.description && (
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{r.description}</div>
                )}
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>
                      {t("settings.routes.when")}
                    </span>{" "}
                    {d.when}
                  </span>
                  <span>
                    <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>
                      {t("settings.routes.then")}
                    </span>{" "}
                    {d.then}
                  </span>
                </div>
              </div>
              {manages && (
                <div style={{ display: "flex", gap: 6, flex: "none" }}>
                  <Link href={`/app/settings/alert-routes/${r.id}`} style={btn}>
                    {t("common.edit")}
                  </Link>
                  <form action={duplicateRoute}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" style={btn}>
                      {t("settings.routes.duplicate")}
                    </button>
                  </form>
                  <form action={toggleRoute}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" style={btn}>
                      {r.testMode
                        ? t("settings.routes.activate")
                        : r.active
                          ? t("settings.routes.deactivate")
                          : t("settings.routes.activate")}
                    </button>
                  </form>
                  <form action={deleteRoute}>
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      type="submit"
                      className="oi-hover-dang"
                      style={icon}
                      aria-label={t("common.delete")}
                    >
                      ✕
                    </button>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
