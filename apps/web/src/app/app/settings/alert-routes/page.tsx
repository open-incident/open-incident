import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import {
  alertPriorities,
  alertRoutes,
  escalationPaths,
  incidentTypes,
  withTenant,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { deleteRoute, duplicateRoute, saveRoute, toggleRoute } from "./actions";

/**
 * Settings → Routes: filters on attributes → a static or dynamic escalation →
 * an incident never / always / conditionally. The editor is a server-rendered
 * modal (`?edit=new|<id>`); "Duplicate" copies in test mode.
 */
export default async function AlertRoutesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { tenant } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const data = await withTenant(tenant.id, async (tx) => ({
    routes: await tx
      .select()
      .from(alertRoutes)
      .where(eq(alertRoutes.tenantId, tenant.id))
      .orderBy(asc(alertRoutes.position), asc(alertRoutes.createdAt)),
    paths: await tx
      .select({ id: escalationPaths.id, name: escalationPaths.name })
      .from(escalationPaths)
      .where(eq(escalationPaths.tenantId, tenant.id))
      .orderBy(asc(escalationPaths.name)),
    priorities: await tx
      .select()
      .from(alertPriorities)
      .where(eq(alertPriorities.tenantId, tenant.id))
      .orderBy(asc(alertPriorities.rank)),
    types: await tx
      .select({ id: incidentTypes.id, name: incidentTypes.name })
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, tenant.id))
      .orderBy(asc(incidentTypes.position)),
  }));
  const editing =
    q.edit === "new" ? "new" : (data.routes.find((r) => r.id === (q.edit ?? q.route)) ?? null);
  const pathName = (id: string | null) => data.paths.find((p) => p.id === id)?.name ?? "—";
  const mono: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: 10.5,
    background: "var(--sunk)",
    borderRadius: 999,
    padding: "2px 8px",
  };
  const arrow = <span style={{ fontSize: 10.5, color: "var(--ink-3)", padding: "2px 0" }}>→</span>;
  const ghost: React.CSSProperties = {
    height: 26,
    padding: "0 10px",
    border: "1px solid var(--line)",
    borderRadius: 7,
    background: "var(--panel)",
    display: "flex",
    alignItems: "center",
    fontSize: 11,
    cursor: "pointer",
    color: "inherit",
    textDecoration: "none",
  };
  const filterText = (f: (typeof data.routes)[number]["filters"][number]) =>
    f.op === "exists"
      ? t("settings.routes.filterExists", { attribute: f.attribute })
      : `${f.attribute} ${f.op === "eq" ? "=" : f.op === "neq" ? "≠" : "∈"} ${f.value ?? ""}`;
  const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".1em",
    textTransform: "uppercase",
    color: "var(--ink-3)",
  };
  const control: React.CSSProperties = {
    height: 36,
    padding: "0 11px",
    border: "1px solid var(--line)",
    borderRadius: 9,
    outline: "none",
    fontSize: 12.5,
    background: "var(--panel)",
    width: "100%",
  };
  const r = editing === "new" ? null : editing;

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 960 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.routes.title")}
        </h1>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("settings.routes.subtitle")}
        </span>
        <span style={{ flex: 1 }} />
        {q.saved === "1" && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        {q.error && (
          <span role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}>
            {t("settings.fields.errorInvalid")}
          </span>
        )}
        <Link
          href="/app/settings/alert-routes?edit=new"
          data-testid="route-new"
          style={{
            height: 32,
            padding: "0 14px",
            borderRadius: 9,
            background: "var(--brand)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            fontSize: 12.5,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {t("settings.routes.new")}
        </Link>
      </div>
      {q.duplicated && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--ok-t)",
            border: "1px solid var(--ok)",
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }} />
          {t("settings.routes.duplicatedMsg", { name: q.duplicated })}
        </div>
      )}
      <div className="oi-panel" style={{ overflow: "hidden" }}>
        {data.routes.map((route, i) => (
          <div
            key={route.id}
            data-testid="route-row"
            style={{
              padding: "12px 16px",
              borderBottom: i < data.routes.length - 1 ? "1px solid var(--line-2)" : undefined,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{route.name}</span>
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: route.testMode
                    ? "var(--wait-t)"
                    : route.active
                      ? "var(--ok-t)"
                      : "var(--sunk)",
                  color: route.testMode
                    ? "var(--wait)"
                    : route.active
                      ? "var(--ok)"
                      : "var(--ink-3)",
                  fontSize: 10.5,
                  fontWeight: 700,
                }}
              >
                {route.testMode
                  ? t("settings.routes.testMode")
                  : route.active
                    ? t("settings.routes.active")
                    : t("settings.routes.inactive")}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {t("settings.routes.count", { count: route.alertCount })}
              </span>
              <Link
                href={`/app/settings/alert-routes?edit=${route.id}`}
                className="oi-hover"
                style={{ ...ghost, fontWeight: 600 }}
              >
                {t("common.edit")}
              </Link>
              <form action={duplicateRoute}>
                <input type="hidden" name="id" value={route.id} />
                <button type="submit" className="oi-hover" style={ghost}>
                  {t("settings.routes.duplicate")}
                </button>
              </form>
              <form action={toggleRoute}>
                <input type="hidden" name="id" value={route.id} />
                <button
                  type="submit"
                  className="oi-hover"
                  style={{
                    ...ghost,
                    ...(route.testMode || !route.active
                      ? { border: "1px solid var(--ok)", color: "var(--ok)", fontWeight: 600 }
                      : {}),
                  }}
                >
                  {route.testMode || !route.active
                    ? t("settings.routes.activate")
                    : t("settings.api.disable")}
                </button>
              </form>
              <form action={deleteRoute}>
                <input type="hidden" name="id" value={route.id} />
                <button
                  type="submit"
                  aria-label={t("common.delete")}
                  className="oi-hover-dang"
                  style={{
                    ...ghost,
                    color: "var(--dang)",
                    width: 26,
                    padding: 0,
                    justifyContent: "center",
                  }}
                >
                  ✕
                </button>
              </form>
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
              <span style={mono}>
                {route.filters.length
                  ? `${t("settings.routes.if")} ${route.filters.map(filterText).join(` ${t("settings.routes.and")} `)}`
                  : t("settings.routes.everything")}
              </span>
              {arrow}
              <span style={{ ...mono, background: "var(--brand-t)", color: "var(--brand)" }}>
                {route.escalationMode === "dynamic"
                  ? t("settings.routes.dynamicChip")
                  : route.escalationMode === "static"
                    ? t("settings.routes.staticChip", { path: pathName(route.escalationPathId) })
                    : t("settings.routes.noneChip", { urgency: route.urgencyOverride ?? "—" })}
              </span>
              {arrow}
              <span style={{ ...mono, background: "var(--viol-t)", color: "var(--viol)" }}>
                {route.testMode
                  ? t("settings.routes.testChip")
                  : t(`settings.routes.incident.${route.incidentMode}`, {
                      type:
                        data.types.find((x) => x.id === route.incidentTypeId)?.name ??
                        t("settings.fields.allTypes"),
                    })}
              </span>
              {route.deferMinutes > 0 && (
                <span style={mono}>
                  {t("settings.routes.deferChip", { count: route.deferMinutes })}
                </span>
              )}
            </div>
          </div>
        ))}
        {data.routes.length === 0 && (
          <div style={{ padding: 16, fontSize: 12.5, color: "var(--ink-3)" }}>
            {t("settings.routes.empty")}
          </div>
        )}
      </div>
      <div
        style={{
          background: "var(--sunk)",
          borderRadius: 14,
          padding: "13px 15px",
          fontSize: 12.5,
          color: "var(--ink-2)",
          lineHeight: 1.55,
        }}
      >
        {t("settings.routes.note")}
      </div>

      {editing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim-dialog)",
            display: "grid",
            placeItems: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <form
            action={saveRoute}
            data-testid="route-form"
            role="dialog"
            className="oi-rise"
            style={{
              width: 620,
              maxWidth: "100%",
              maxHeight: "90vh",
              overflow: "auto",
              background: "var(--panel)",
              borderRadius: 18,
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <input type="hidden" name="id" value={r?.id ?? ""} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div style={{ fontFamily: "var(--font-title)", fontSize: 16.5, fontWeight: 600 }}>
                {r
                  ? t("settings.routes.editTitle", { name: r.name })
                  : t("settings.routes.newTitle")}
              </div>
              <Link
                href="/app/settings/alert-routes"
                aria-label={t("common.close")}
                style={{
                  marginLeft: "auto",
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--ink-3)",
                  fontSize: 14,
                  textDecoration: "none",
                }}
              >
                ✕
              </Link>
            </div>
            <div
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 13 }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.routes.name")}</span>
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={80}
                  defaultValue={r?.name ?? ""}
                  placeholder="Production alerts"
                  className="oi-field"
                  style={control}
                />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.routes.filters")}</span>
                {[0, 1, 2].map((i) => {
                  const f = r?.filters[i];
                  return (
                    <div
                      key={i}
                      style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr 1.4fr", gap: 8 }}
                    >
                      <input
                        name={`f${i}_attribute`}
                        defaultValue={f?.attribute ?? (i === 0 && !r ? "environment" : "")}
                        placeholder="environment"
                        className="oi-field"
                        style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                        list="route-attributes"
                      />
                      <select
                        name={`f${i}_op`}
                        defaultValue={f?.op ?? "eq"}
                        className="oi-field"
                        style={control}
                      >
                        <option value="eq">=</option>
                        <option value="neq">≠</option>
                        <option value="in">∈ (a, b)</option>
                        <option value="exists">{t("settings.routes.exists")}</option>
                      </select>
                      <input
                        name={`f${i}_value`}
                        defaultValue={f?.value ?? (i === 0 && !r ? "production" : "")}
                        placeholder="production"
                        className="oi-field"
                        style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                      />
                    </div>
                  );
                })}
                <datalist id="route-attributes">
                  {["environment", "service", "team", "priority", "source", "region"].map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.routes.escalation")}</span>
                  <select
                    name="escalationMode"
                    defaultValue={r?.escalationMode ?? "dynamic"}
                    className="oi-field"
                    style={control}
                  >
                    <option value="dynamic">{t("settings.routes.escalationDynamic")}</option>
                    <option value="static">{t("settings.routes.escalationStatic")}</option>
                    <option value="none">{t("settings.routes.escalationNone")}</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.routes.path")}</span>
                  <select
                    name="escalationPathId"
                    defaultValue={r?.escalationPathId ?? ""}
                    className="oi-field"
                    style={control}
                  >
                    <option value="">{t("settings.routes.pathFallback")}</option>
                    {data.paths.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.routes.incidentLabel")}</span>
                  <select
                    name="incidentMode"
                    defaultValue={r?.incidentMode ?? "conditional"}
                    className="oi-field"
                    style={control}
                  >
                    <option value="conditional">{t("settings.routes.incidentConditional")}</option>
                    <option value="always">{t("settings.routes.incidentAlways")}</option>
                    <option value="never">{t("settings.routes.incidentNever")}</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.fields.incidentType")}</span>
                  <select
                    name="incidentTypeId"
                    defaultValue={r?.incidentTypeId ?? ""}
                    className="oi-field"
                    style={control}
                  >
                    <option value="">{t("settings.routes.defaultType")}</option>
                    {data.types.map((ty) => (
                      <option key={ty.id} value={ty.id}>
                        {ty.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.routes.priority")}</span>
                  <select
                    name="priorityId"
                    defaultValue={r?.priorityId ?? ""}
                    className="oi-field"
                    style={control}
                  >
                    <option value="">{t("settings.routes.priorityFromPayload")}</option>
                    {data.priorities.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.routes.urgency")}</span>
                  <select
                    name="urgencyOverride"
                    defaultValue={r?.urgencyOverride ?? ""}
                    className="oi-field"
                    style={control}
                  >
                    <option value="">{t("settings.routes.urgencyFromPriority")}</option>
                    <option value="high">high</option>
                    <option value="low">low</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.routes.defer")}</span>
                  <select
                    name="deferMinutes"
                    defaultValue={String(r?.deferMinutes ?? 0)}
                    className="oi-field"
                    style={control}
                  >
                    {[0, 1, 2, 5, 10].map((m) => (
                      <option key={m} value={m}>
                        {m === 0 ? t("notif.immediate") : `${m} min`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                }}
              >
                <input type="checkbox" name="testMode" defaultChecked={r?.testMode ?? false} />{" "}
                {t("settings.routes.testModeLabel")}
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                }}
              >
                <input
                  type="checkbox"
                  name="resolveClosesEscalation"
                  value="on"
                  defaultChecked={r?.resolveClosesEscalation ?? true}
                />{" "}
                {t("settings.routes.resolveCloses")}
                <input type="hidden" name="resolveClosesEscalation" value="off" />
              </label>
              <div
                className="oi-note"
                style={{ borderRadius: 11, padding: "11px 13px", fontSize: 12 }}
              >
                {t("settings.routes.formNote")}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "14px 20px",
                borderTop: "1px solid var(--line)",
              }}
            >
              <span style={{ flex: 1 }} />
              <Link
                href="/app/settings/alert-routes"
                className="oi-hover"
                style={{
                  height: 34,
                  padding: "0 13px",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  background: "var(--panel)",
                  display: "flex",
                  alignItems: "center",
                  fontSize: 12.5,
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                {t("common.cancel")}
              </Link>
              <button
                type="submit"
                style={{
                  height: 34,
                  padding: "0 16px",
                  borderRadius: 9,
                  background: "var(--brand)",
                  color: "#fff",
                  border: 0,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {r ? t("common.save") : t("common.create")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
