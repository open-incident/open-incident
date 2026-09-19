import Link from "next/link";
import { eq } from "drizzle-orm";
import { alertRoutes, alertSources, escalationPaths, withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { describeRoute } from "@/lib/route-summary";
import { isDefaultsRoute } from "@/lib/settings-rule-preview";
import { deleteRoute, duplicateRoute, moveRoute, toggleRoute } from "./actions";
import { loadEditorData } from "./editor-data";
import { RouteEditor } from "./route-editor";

const PAGE = "/app/settings/alert-routes";

const ghost: React.CSSProperties = {
  height: 26,
  padding: "0 10px",
  border: "1px solid var(--line)",
  borderRadius: 7,
  background: "var(--panel)",
  display: "inline-flex",
  alignItems: "center",
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
  color: "inherit",
  textDecoration: "none",
};
const iconBtn: React.CSSProperties = {
  ...ghost,
  width: 26,
  padding: 0,
  justifyContent: "center",
  color: "var(--ink-3)",
};

/**
 * Rules — the exceptions to what the sources already decide, in the order they
 * are tried. Each row reads as a sentence; the first one whose conditions hold
 * wins, and a source with no rule above it keeps its own three choices.
 *
 * The editor opens inline, below the list, as the design draws it. Its own URL
 * (`/app/settings/alert-routes/<id>`) still works and renders the same card.
 */
export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; edit?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { saved, error, edit } = await searchParams;
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

  // A manager only: the editor writes, and `saveRoute` refuses anyone else.
  const editing = manages && edit ? (edit === "new" ? "new" : edit) : null;
  const editor = editing
    ? await loadEditorData(tenant.id, editing === "new" ? null : editing)
    : null;
  const editorIndex = editor?.route
    ? data.routes.findIndex((r) => r.id === editor.route!.id) + 1
    : undefined;

  const unpublished = (r: (typeof data.routes)[number]) =>
    r.escalations.some((e) => {
      const id = e.kind === "path" ? e.pathId : e.fallbackPathId;
      const p = id ? data.paths.find((x) => x.id === id) : null;
      return id && (!p || !p.current);
    });

  return (
    <div className="oi-rise" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 21,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t("set2.rules.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("set2.rules.subtitle")}</span>
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
            href={`${PAGE}?edit=new`}
            data-testid="route-new"
            className="oi-hover-brand-2"
            style={{
              height: 32,
              padding: "0 13px",
              borderRadius: 9,
              background: "var(--brand)",
              color: "var(--on-brand)",
              display: "flex",
              alignItems: "center",
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {t("set2.rules.new")}
          </Link>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--sunk)",
          borderRadius: 12,
          padding: "10px 14px",
          fontSize: 12.5,
          color: "var(--ink-2)",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "var(--brand)",
            flex: "none",
          }}
        />
        {t("set2.rules.firstWins")}
      </div>

      {data.routes.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--line)",
            borderRadius: "var(--radius-card)",
            padding: 26,
            textAlign: "center",
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          {t("set2.rules.empty")}
        </div>
      ) : (
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
            overflow: "hidden",
          }}
        >
          {data.routes.map((r, i) => {
            const d = describeRoute(r, t, { paths: data.paths, sources: data.sources });
            const defaults = isDefaultsRoute(r);
            return (
              <div
                key={r.id}
                data-testid="route-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderBottom: i < data.routes.length - 1 ? "1px solid var(--line-2)" : undefined,
                  opacity: r.active ? 1 : 0.6,
                  background: editor?.route?.id === r.id ? "var(--brand-t)" : undefined,
                }}
              >
                {/* The design draws a drag handle; reordering is served by the
                    two arrows, which is what the back end actually offers. */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    flex: "none",
                    width: 14,
                  }}
                >
                  {manages ? (
                    <>
                      <form action={moveRoute} style={{ display: "contents" }}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="dir" value="up" />
                        <button
                          type="submit"
                          disabled={i === 0}
                          aria-label={t("common.previous")}
                          style={{
                            border: 0,
                            background: "transparent",
                            color: i === 0 ? "var(--line-2)" : "var(--ink-3)",
                            cursor: i === 0 ? "default" : "pointer",
                            fontSize: 9,
                            lineHeight: 1,
                            padding: 0,
                          }}
                        >
                          ▲
                        </button>
                      </form>
                      <form action={moveRoute} style={{ display: "contents" }}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="dir" value="down" />
                        <button
                          type="submit"
                          disabled={i === data.routes.length - 1}
                          aria-label={t("common.next")}
                          style={{
                            border: 0,
                            background: "transparent",
                            color: i === data.routes.length - 1 ? "var(--line-2)" : "var(--ink-3)",
                            cursor: i === data.routes.length - 1 ? "default" : "pointer",
                            fontSize: 9,
                            lineHeight: 1,
                            padding: 0,
                          }}
                        >
                          ▼
                        </button>
                      </form>
                    </>
                  ) : (
                    <span aria-hidden style={{ color: "var(--line)", fontSize: 11 }}>
                      ⠿
                    </span>
                  )}
                </div>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--ink-3)",
                    width: 14,
                    flex: "none",
                  }}
                >
                  {i + 1}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <span>
                    <strong style={{ fontWeight: 600 }}>{r.name}</strong>
                    <span style={{ color: "var(--ink-2)" }}>
                      {" — "}
                      {t("set2.ed.if")} {d.when} {t("set2.ed.then")} {d.then}
                    </span>
                  </span>
                </span>
                {/* Shape, not provenance: the row carries no condition, which
                    is all this screen can honestly tell from the record. */}
                {defaults && (
                  <span
                    title={t("set2.rules.defaultsHint")}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--ink-3)",
                      background: "var(--sunk)",
                      borderRadius: 5,
                      padding: "1px 6px",
                      flex: "none",
                      cursor: "help",
                    }}
                  >
                    {t("set2.rules.defaultsChip")}
                  </span>
                )}
                {!r.active && (
                  <span
                    style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-3)", flex: "none" }}
                  >
                    {t("settings.routes.inactive")}
                  </span>
                )}
                {r.testMode && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--viol)",
                      background: "var(--viol-t)",
                      borderRadius: 5,
                      padding: "1px 6px",
                      flex: "none",
                    }}
                  >
                    {t("settings.routes.testMode")}
                  </span>
                )}
                {unpublished(r) && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--dang)",
                      background: "var(--dang-t)",
                      borderRadius: 5,
                      padding: "1px 6px",
                      flex: "none",
                    }}
                  >
                    {t("settings.routes.unpublishedPath")}
                  </span>
                )}
                <span style={{ fontSize: 11.5, color: "var(--ink-3)", flex: "none" }}>
                  {t("set2.rules.matched", { count: r.alertCount })}
                </span>
                {manages && (
                  <div style={{ display: "flex", gap: 6, flex: "none" }}>
                    <Link href={`${PAGE}?edit=${r.id}`} className="oi-hover" style={ghost}>
                      {t("common.edit")}
                    </Link>
                    <form action={duplicateRoute}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="oi-hover" style={ghost}>
                        {t("settings.routes.duplicate")}
                      </button>
                    </form>
                    <form action={toggleRoute}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="oi-hover" style={ghost}>
                        {r.testMode || !r.active
                          ? t("settings.routes.activate")
                          : t("settings.routes.deactivate")}
                      </button>
                    </form>
                    <form action={deleteRoute}>
                      <input type="hidden" name="id" value={r.id} />
                      <button
                        type="submit"
                        className="oi-hover-dang"
                        style={iconBtn}
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
      )}

      {!manages && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("set2.rules.readOnly")}
        </p>
      )}

      {editor && (
        <RouteEditor
          // The editor holds the draft in state: moving from one rule to
          // another — or to a new one — must remount it, not reconcile it.
          key={editing ?? "new"}
          route={editor.route}
          index={editorIndex}
          cancelHref={PAGE}
          attributes={editor.attributes.map((a) => ({
            key: a.key,
            label: a.label,
            type: a.type,
            catalogTypeKey: a.catalogTypeKey,
          }))}
          sources={editor.sources}
          paths={editor.paths.map((p) => ({
            id: p.id,
            name: p.name,
            published: Boolean(p.current),
          }))}
          types={editor.types}
          severities={editor.sevs}
          priorities={editor.prios}
          fields={editor.fields}
          people={editor.targets.people.filter((p) => p.id !== member.id)}
          schedules={editor.targets.schedules}
          slackInstalled={editor.slack}
          channels={editor.channels}
        />
      )}
    </div>
  );
}
