import Link from "next/link";
import { and, asc, eq, gte } from "drizzle-orm";
import {
  incidentFields,
  incidentStatuses,
  incidentTypes,
  incidents,
  postIncidentTaskDefs,
  severities,
  teams,
  withTenant,
} from "@openincident/db";
import { sql } from "drizzle-orm";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { severityInk } from "@/lib/tones";
import {
  addStatus,
  deleteStatus,
  deleteType,
  moveStatus,
  saveLifecycle,
  saveSeverity,
  saveStatus,
} from "./actions";
import { deleteTask } from "../post-incident/actions";
import { NewTaskDialog } from "../post-incident/new-task";
import { TemplateEditor } from "../post-incident/template-editor";
import { templateFor } from "@/lib/post-mortem";
import { isManager } from "@/lib/session";
import { TypeSwitcher } from "./type-switcher";
import { SaveBar, Section } from "@/components/settings/form";
import { NewTypeDialog } from "./new-type";

/**
 * Settings → Types & lifecycle: the type cards, then the selected type's
 * lifecycle strip — Triage → Active (its statuses as chips) → Post-incident →
 * Closed — with the selected node's card on the right; and the Severities
 * segment, one row per level with an inline editor. Statuses and severities
 * save for real. Creating a type and editing its declaration form land next.
 */
export default async function TypesPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    seg?: string;
    status?: string;
    sev?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  const { tenant, workspace, member } = await requireMember();
  const t = await getT();
  const params = await searchParams;
  const data = await withTenant(tenant.id, async (tx) => {
    const types = await tx
      .select()
      .from(incidentTypes)
      .where(eq(incidentTypes.tenantId, tenant.id))
      .orderBy(asc(incidentTypes.position));
    const statuses = await tx
      .select()
      .from(incidentStatuses)
      .where(eq(incidentStatuses.tenantId, tenant.id))
      .orderBy(asc(incidentStatuses.rank));
    const sevs = await tx
      .select()
      .from(severities)
      .where(eq(severities.tenantId, tenant.id))
      .orderBy(asc(severities.rank));
    const fields = await tx
      .select()
      .from(incidentFields)
      .where(eq(incidentFields.tenantId, tenant.id))
      .orderBy(asc(incidentFields.position));
    const since = new Date(Date.now() - 90 * 86_400_000);
    const counts = await tx
      .select({ typeId: incidents.typeId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenant.id), gte(incidents.declaredAt, since)))
      .groupBy(incidents.typeId);
    const allCounts = await tx
      .select({ typeId: incidents.typeId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(incidents)
      .where(eq(incidents.tenantId, tenant.id))
      .groupBy(incidents.typeId);
    const inStatus = await tx
      .select({ statusId: incidents.statusId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenant.id), eq(incidents.phase, "active")))
      .groupBy(incidents.statusId);
    const defs = await tx
      .select()
      .from(postIncidentTaskDefs)
      .where(eq(postIncidentTaskDefs.tenantId, tenant.id))
      .orderBy(asc(postIncidentTaskDefs.phase), asc(postIncidentTaskDefs.position));
    return {
      defs,
      types,
      statuses,
      sevs,
      fields,
      counts: new Map(counts.map((c) => [c.typeId, c.n])),
      allCounts: new Map(allCounts.map((c) => [c.typeId, c.n])),
      inStatus: new Map(inStatus.map((c) => [c.statusId, c.n])),
    };
  });
  const seg = params.seg === "severities" ? "severities" : "types";
  const type =
    data.types.find((ty) => ty.id === params.type) ??
    data.types.find((ty) => ty.isDefault) ??
    data.types[0];
  if (!type) return null;
  const statuses = data.statuses.filter((s) => s.typeId === type.id);
  const editing = params.status === "new" ? "new" : statuses.find((s) => s.id === params.status);
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ type: type.id, seg, ...patch })) if (v) p.set(k, v);
    return `/app/settings/types?${p.toString()}`;
  };
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
    fontSize: 13,
    background: "var(--panel)",
    width: "100%",
  };
  const ghostBtn: React.CSSProperties = {
    height: 28,
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
    gap: 6,
    whiteSpace: "nowrap",
  };
  const brandBtn: React.CSSProperties = {
    height: 32,
    padding: "0 14px",
    borderRadius: 9,
    background: "var(--brand)",
    color: "var(--on-brand)",
    border: 0,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
  };

  const teamRows = await withTenant(tenant.id, (tx) =>
    tx
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.tenantId, tenant.id))
      .orderBy(asc(teams.name)),
  );

  return (
    <div className="oi-rise" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="oi-head">
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.types.title")}
        </h1>
        <span className="oi-subtitle">{t("settings.types.subtitle")}</span>
        <span style={{ flex: 1 }} />
        {params.saved === "1" && seg === "severities" && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        {params.error && (
          <span role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dang)" }}>
            {params.error === "duplicate"
              ? t("settings.types.errorDuplicate")
              : params.error === "in_use"
                ? t("settings.types.errorInUse")
                : params.error === "status_in_use"
                  ? t("settings.types.errorStatusInUse")
                  : params.error === "last_status"
                    ? t("settings.types.errorLastStatus")
                    : params.error === "refused"
                      ? t("settings.types.errorRefused")
                      : t("settings.fields.errorInvalid")}
          </span>
        )}
        <NewTypeDialog
          types={data.types.map((ty) => ({ id: ty.id, name: ty.name, isDefault: ty.isDefault }))}
          teams={teamRows}
        />
      </div>

      {seg === "types" ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/*
            One form for the whole sheet, declared once and empty: every field
            below names it with `form="lifecycle"`, so the sheet can interleave
            what is saved (the type, its form, its rule, the shared post-mortem
            parts) with what is created and removed on the spot (statuses,
            tasks) without nesting forms. The hidden first button makes Enter
            in a field save, not reset the template.
          */}
          <form id="lifecycle" action={saveLifecycle}>
            <input type="hidden" name="typeId" value={type.id} />
            <button type="submit" tabIndex={-1} aria-hidden style={{ display: "none" }} />
          </form>

          <div
            className="oi-panel"
            style={{
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 8,
            }}
          >
            <span className="oi-label">{t("settings.types.typeLabel")}</span>
            <TypeSwitcher
              current={type.id}
              label={t("settings.types.typeLabel")}
              types={data.types.map((ty) => ({
                id: ty.id,
                name: ty.name,
                count: data.counts.get(ty.id) ?? 0,
                isDefault: ty.isDefault,
              }))}
            />
            <span className="oi-subtitle">
              {t("settings.types.incidentCount", { count: data.counts.get(type.id) ?? 0 })}
            </span>
            <span style={{ flex: 1 }} />
            {type.isDefault ? (
              <span className="oi-subtitle">{t("settings.types.defaultTypeNote")}</span>
            ) : (data.allCounts.get(type.id) ?? 0) > 0 ? (
              <span className="oi-subtitle">
                {t("settings.types.deleteTypeInUse", { count: data.allCounts.get(type.id) ?? 0 })}
              </span>
            ) : (
              <form action={deleteType}>
                <input type="hidden" name="typeId" value={type.id} />
                <button
                  type="submit"
                  className="oi-btn oi-btn-sm oi-btn-danger"
                  data-testid="type-delete"
                >
                  {t("settings.types.deleteType")}
                </button>
              </form>
            )}
          </div>

          <Section
            n={1}
            title={t("settings.types.sectionType")}
            hint={t("settings.types.sectionTypeHint")}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) minmax(0,1.6fr)",
                gap: 12,
              }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.types.typeName")}</span>
                <input
                  form="lifecycle"
                  name="name"
                  defaultValue={type.name}
                  required
                  minLength={2}
                  maxLength={60}
                  className="oi-field"
                  style={control}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.types.typeDescription")}</span>
                <input
                  form="lifecycle"
                  name="description"
                  defaultValue={type.description ?? ""}
                  maxLength={200}
                  className="oi-field"
                  style={control}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.types.declarableBy")}</span>
                <select
                  form="lifecycle"
                  name="teamId"
                  defaultValue={type.isDefault ? "" : (type.restrictedToTeamIds?.[0] ?? "")}
                  disabled={type.isDefault}
                  className="oi-field"
                  style={control}
                >
                  <option value="">{t("settings.types.everyone")}</option>
                  {teamRows.map((tm) => (
                    <option key={tm.id} value={tm.id}>
                      {tm.name}
                    </option>
                  ))}
                </select>
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  fontSize: 13,
                  paddingTop: 22,
                }}
              >
                <input
                  form="lifecycle"
                  type="checkbox"
                  name="privateByDefault"
                  defaultChecked={type.privateByDefault}
                  style={{ marginTop: 3 }}
                />
                <span style={{ lineHeight: 1.45 }}>
                  {t("settings.types.privateByDefault")}
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>
                    {t("settings.types.privateHint")}
                  </span>
                </span>
              </label>
            </div>
          </Section>

          <Section
            n={2}
            title={t("settings.types.formTitle")}
            hint={t("settings.types.formHint")}
            more={
              <Link href="/app/settings/fields" className="oi-link" style={{ fontSize: 12 }}>
                {t("settings.types.manageFields")}
              </Link>
            }
          >
            <div className="oi-panel" style={{ overflow: "hidden" }}>
              {(
                [
                  ...(["title", "severity", "service", "summary"] as const).map((k) => ({
                    key: k,
                    name: t(`settings.types.systemField.${k}`),
                    mono: false,
                    fixed: k === "title",
                  })),
                  ...data.fields
                    .filter((f) => f.incidentTypeId === null || f.incidentTypeId === type.id)
                    .map((f) => ({ key: f.key, name: f.label, mono: true, fixed: false })),
                ] as const
              ).map((f, i, all) => {
                const inForm = type.declareForm.find((x) => x.key === f.key);
                const ask = f.fixed
                  ? "required"
                  : inForm
                    ? inForm.required
                      ? "required"
                      : "optional"
                    : "off";
                return (
                  <div
                    key={f.key}
                    data-testid="form-field"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "9px 18px",
                      borderBottom: i < all.length - 1 ? "1px solid var(--line-2)" : undefined,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>
                      {f.name}
                      {f.mono && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontFamily: "var(--font-mono)",
                            fontWeight: 400,
                            fontSize: 11.5,
                            color: "var(--ink-3)",
                          }}
                        >
                          {f.key}
                        </span>
                      )}
                    </span>
                    <div role="radiogroup" style={{ display: "flex", gap: 2 }}>
                      {(["required", "optional", "off"] as const).map((choice) => (
                        <label
                          key={choice}
                          style={{
                            fontSize: 11.5,
                            fontWeight: 600,
                            padding: "3px 10px",
                            borderRadius: 999,
                            border: `1px solid ${ask === choice ? "var(--brand)" : "var(--line)"}`,
                            background: ask === choice ? "var(--brand-t)" : "var(--panel)",
                            color:
                              ask === choice
                                ? "var(--brand)"
                                : f.fixed
                                  ? "var(--line)"
                                  : "var(--ink-2)",
                            cursor: f.fixed ? "default" : "pointer",
                          }}
                        >
                          <input
                            type="radio"
                            form="lifecycle"
                            name={`ask.${f.key}`}
                            value={choice}
                            defaultChecked={ask === choice}
                            disabled={f.fixed}
                            style={{ display: "none" }}
                          />
                          {t(`settings.types.ask.${choice}`)}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <div style={{ padding: "26px 0 4px", borderTop: "1px solid var(--line-2)" }}>
            <h2 className="oi-section-title" style={{ fontSize: 17 }}>
              {t("settings.types.lifecycleTitle")}
            </h2>
            <p className="oi-section-hint" style={{ maxWidth: 640 }}>
              {t("settings.types.lifecycleHint")}
            </p>
          </div>

          <Section
            marker={{ label: t("settings.types.phaseTriage"), color: "var(--viol)" }}
            title={t("settings.types.triageTitle")}
            hint={t("settings.types.triageDesc")}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
              <div>
                <span style={{ color: "var(--ink-3)" }}>{t("settings.types.row.entry")} · </span>
                {t("settings.types.triageEntry")}
              </div>
              <div>
                <span style={{ color: "var(--ink-3)" }}>{t("settings.types.row.actions")} · </span>
                {t("settings.types.phaseTriageSub")}
              </div>
              <div>
                <span className="oi-shared">{t("settings.types.sharedChip")}</span>
              </div>
            </div>
          </Section>

          <Section
            marker={{ label: t("settings.types.phaseActive"), color: "var(--open)" }}
            title={t("settings.types.statusesTitle")}
            hint={t("settings.types.statusesHint")}
          >
            <div className="oi-panel" style={{ overflow: "hidden" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 18px",
                  borderBottom: "1px solid var(--line)",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 12.5, color: "var(--ink-3)", flex: 1 }}>
                  {t("settings.types.statusesCount", { count: statuses.length })}
                </span>
                {editing !== "new" && (
                  <Link
                    href={href({ status: "new" })}
                    className="oi-hover"
                    data-testid="status-add"
                    style={{ ...ghostBtn, textDecoration: "none" }}
                  >
                    {t("settings.types.addStatus")}
                  </Link>
                )}
              </div>
              {statuses.map((st, i) => {
                const open = editing !== "new" && editing?.id === st.id;
                const inIt = data.inStatus.get(st.id) ?? 0;
                return (
                  <div
                    key={st.id}
                    data-testid="status-row"
                    style={{ borderBottom: "1px solid var(--line-2)" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 18px",
                        background: open ? "var(--brand-t)" : undefined,
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 1, width: 14 }}>
                        {(["up", "down"] as const).map((dir) => {
                          const edge = dir === "up" ? i === 0 : i === statuses.length - 1;
                          return (
                            <form key={dir} action={moveStatus} style={{ display: "contents" }}>
                              <input type="hidden" name="statusId" value={st.id} />
                              <input type="hidden" name="typeId" value={type.id} />
                              <input type="hidden" name="dir" value={dir} />
                              <button
                                type="submit"
                                disabled={edge}
                                aria-label={dir === "up" ? t("common.previous") : t("common.next")}
                                style={{
                                  border: 0,
                                  background: "transparent",
                                  color: edge ? "var(--line-2)" : "var(--ink-3)",
                                  cursor: edge ? "default" : "pointer",
                                  fontSize: 9,
                                  lineHeight: 1,
                                  padding: 0,
                                }}
                              >
                                {dir === "up" ? "▲" : "▼"}
                              </button>
                            </form>
                          );
                        })}
                      </div>
                      <span
                        style={{
                          width: 18,
                          fontSize: 11.5,
                          color: "var(--ink-3)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {i + 1}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                          {st.name}
                          {st.description && (
                            <span style={{ fontWeight: 400, color: "var(--ink-2)" }}>
                              {" "}
                              — {st.description}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>
                          {[
                            st.updateReminderMinutes
                              ? t("settings.types.statusMeta.reminder", {
                                  minutes: st.updateReminderMinutes,
                                })
                              : t("settings.types.statusMeta.noReminder"),
                            st.publicStatus
                              ? t("settings.types.statusMeta.public", { status: st.publicStatus })
                              : t("settings.types.statusMeta.notPublic"),
                            st.countsInMttr
                              ? t("settings.types.statusMeta.mttr")
                              : t("settings.types.statusMeta.noMttr"),
                          ].join(" · ")}
                        </div>
                      </div>
                      <span style={{ fontSize: 11.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                        {t("settings.types.statusIncidents", { count: inIt })}
                      </span>
                      <Link
                        href={href({ status: open ? undefined : st.id })}
                        className="oi-hover"
                        style={{ ...ghostBtn, textDecoration: "none" }}
                      >
                        {open ? t("common.close") : t("common.edit")}
                      </Link>
                      <form action={deleteStatus}>
                        <input type="hidden" name="statusId" value={st.id} />
                        <input type="hidden" name="typeId" value={type.id} />
                        <button
                          type="submit"
                          disabled={inIt > 0 || statuses.length <= 1}
                          title={
                            inIt > 0
                              ? t("settings.types.errorStatusInUse")
                              : statuses.length <= 1
                                ? t("settings.types.errorLastStatus")
                                : t("common.delete")
                          }
                          aria-label={t("common.delete")}
                          className="oi-hover-dang"
                          style={{
                            ...ghostBtn,
                            width: 28,
                            padding: 0,
                            justifyContent: "center",
                            color: inIt > 0 || statuses.length <= 1 ? "var(--line)" : "var(--dang)",
                            cursor: inIt > 0 || statuses.length <= 1 ? "default" : "pointer",
                          }}
                        >
                          ✕
                        </button>
                      </form>
                    </div>
                    {open && (
                      <form
                        action={saveStatus}
                        data-testid="status-form"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                          gap: 12,
                          padding: "12px 18px 14px 62px",
                          background: "var(--sunk)",
                          alignItems: "end",
                        }}
                      >
                        <input type="hidden" name="statusId" value={st.id} />
                        <input type="hidden" name="typeId" value={type.id} />
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={label}>{t("settings.types.statusName")}</span>
                          <input
                            name="name"
                            defaultValue={st.name}
                            required
                            maxLength={60}
                            className="oi-field"
                            style={control}
                          />
                        </label>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={label}>{t("settings.types.statusDescription")}</span>
                          <input
                            name="description"
                            defaultValue={st.description ?? ""}
                            maxLength={200}
                            className="oi-field"
                            style={control}
                          />
                        </label>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={label}>{t("settings.types.updateReminder")}</span>
                          <select
                            name="updateReminderMinutes"
                            defaultValue={String(st.updateReminderMinutes ?? "")}
                            className="oi-field"
                            style={control}
                          >
                            <option value="">{t("incident.update.noReminder")}</option>
                            {[15, 30, 60, 120].map((m) => (
                              <option key={m} value={m}>
                                {t("incident.update.inMinutes", { count: m })}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={label}>{t("settings.types.publicStatus")}</span>
                          <select
                            name="publicStatus"
                            defaultValue={st.publicStatus ?? ""}
                            className="oi-field"
                            style={control}
                          >
                            <option value="">— ({t("settings.types.publicNone")})</option>
                            {["investigating", "identified", "monitoring"].map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 12.5,
                            height: 34,
                          }}
                        >
                          <input
                            type="checkbox"
                            name="countsInMttr"
                            defaultChecked={st.countsInMttr}
                          />
                          {t("settings.types.countsInMttr")}
                        </label>
                        <button type="submit" className="oi-hover-brand-2" style={brandBtn}>
                          {t("common.save")}
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
              {editing === "new" && (
                <form
                  action={addStatus}
                  data-testid="status-new-form"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 18px",
                    background: "var(--sunk)",
                  }}
                >
                  <input type="hidden" name="typeId" value={type.id} />
                  <input
                    name="name"
                    required
                    autoFocus
                    maxLength={60}
                    placeholder={t("settings.types.newStatusPlaceholder")}
                    className="oi-field"
                    style={{ ...control, maxWidth: 320 }}
                  />
                  <button type="submit" className="oi-hover-brand-2" style={brandBtn}>
                    {t("common.create")}
                  </button>
                  <Link
                    href={href({})}
                    className="oi-hover"
                    style={{ ...ghostBtn, textDecoration: "none" }}
                  >
                    {t("common.cancel")}
                  </Link>
                </form>
              )}
            </div>
          </Section>

          <Section
            id="post-incident"
            marker={{ label: t("settings.types.phasePost"), color: "var(--brand)" }}
            title={t("settings.types.postIncidentTitle")}
            hint={t("settings.types.postFlowHint")}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                fontSize: 13,
              }}
            >
              <span style={{ flex: "1 1 220px" }}>{t("settings.types.postIncidentRule")}</span>
              <select
                form="lifecycle"
                name="rule"
                defaultValue={
                  type.postIncidentFromRank === null
                    ? "never"
                    : type.postIncidentFromRank === -1
                      ? "always"
                      : String(type.postIncidentFromRank)
                }
                className="oi-field"
                style={{ ...control, width: 220 }}
              >
                <option value="never">{t("settings.types.postRule.never")}</option>
                <option value="always">{t("settings.types.postRule.always")}</option>
                {data.sevs.slice(0, -1).map((sv) => (
                  <option key={sv.id} value={sv.rank}>
                    {t("settings.types.postRule.from", { severity: sv.name })}
                  </option>
                ))}
              </select>
            </label>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 10,
                paddingTop: 12,
                borderTop: "1px dashed var(--line)",
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                {t("settings.types.sharedTitle")}
              </span>
              <span className="oi-shared">{t("settings.types.sharedChip")}</span>
            </div>

            {(["documenting", "reviewing"] as const).map((phase, n) => {
              const rows = data.defs.filter((d) => d.phase === phase);
              return (
                <div key={phase} className="oi-panel" style={{ overflow: "hidden" }}>
                  <div
                    style={{
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--line)",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {t("settings.postIncident.phaseTitle", {
                      n: n + 1,
                      name: t(`postIncident.phase.${phase}`),
                    })}
                  </div>
                  {rows.map((d) => (
                    <div
                      key={d.id}
                      data-testid="task-def-row"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 14px",
                        borderBottom: "1px solid var(--line-2)",
                        fontSize: 12.5,
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {d.title}
                        <span style={{ color: "var(--ink-3)" }}>
                          {d.defaultAssigneeRole
                            ? ` — ${t(`settings.postIncident.assignee.${d.defaultAssigneeRole as "lead" | "communication"}`)}`
                            : ""}
                          {d.dueAfterDays
                            ? ` · ${t("settings.postIncident.dueAfter", { count: d.dueAfterDays })}`
                            : ""}
                        </span>
                      </span>
                      <form action={deleteTask}>
                        <input type="hidden" name="id" value={d.id} />
                        <input
                          type="hidden"
                          name="back"
                          value={`/app/settings/types?type=${type.id}`}
                        />
                        <button
                          type="submit"
                          aria-label={t("common.delete")}
                          className="oi-hover-dang"
                          style={{
                            height: 26,
                            width: 26,
                            border: 0,
                            borderRadius: 7,
                            background: "transparent",
                            color: "var(--ink-3)",
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          ✕
                        </button>
                      </form>
                    </div>
                  ))}
                  <NewTaskDialog phase={phase} back={`/app/settings/types?type=${type.id}`} />
                </div>
              );
            })}

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("settings.postIncident.term")}</span>
              <input
                form="lifecycle"
                name="term"
                defaultValue={workspace.postMortemTerm ?? ""}
                placeholder={t("postMortem.title")}
                maxLength={40}
                className="oi-field"
                style={{ ...control, width: 260 }}
              />
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {t("settings.postIncident.termHint")}
              </span>
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("settings.postIncident.template")}</span>
              <TemplateEditor
                form="lifecycle"
                sections={templateFor(workspace, t)}
                isDefault={
                  !workspace.postMortemTemplate || workspace.postMortemTemplate.length === 0
                }
                canManage={isManager(member)}
              />
            </div>
          </Section>

          <Section
            marker={{ label: t("settings.types.phaseClosed"), color: "var(--ink-2)" }}
            title={t("settings.types.closedTitle")}
            hint={t("settings.types.closedDesc")}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
              <div>
                <span style={{ color: "var(--ink-3)" }}>{t("settings.types.row.skip")} · </span>
                {t("settings.types.closedSkip")}
              </div>
              <div>
                <span style={{ color: "var(--ink-3)" }}>{t("settings.types.row.reopen")} · </span>
                {t("settings.types.closedReopen")}
              </div>
              <div>
                <span className="oi-shared">{t("settings.types.sharedChip")}</span>
              </div>
            </div>
          </Section>

          {isManager(member) && (
            <SaveBar
              form="lifecycle"
              label={t("common.save")}
              status={params.saved === "1" ? t("common.saved") : undefined}
            />
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="oi-panel" style={{ overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 18px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                {t("settings.types.segSeverities")}
              </span>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("settings.types.severitiesSub")}
              </span>
            </div>
            {data.sevs.map((sv) => {
              const open = params.sev === sv.id;
              return (
                <div key={sv.id}>
                  <Link
                    href={href({ sev: open ? undefined : sv.id })}
                    className="oi-hover"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 18px",
                      borderBottom: "1px solid var(--line-2)",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: severityInk(sv.rank),
                        flex: "none",
                      }}
                    />
                    <span
                      style={{
                        width: 52,
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        fontWeight: 500,
                        flex: "none",
                      }}
                    >
                      {sv.name}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12.5,
                        color: "var(--ink-2)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {sv.description}
                    </span>
                    <span
                      style={{
                        padding: "2px 9px",
                        borderRadius: 999,
                        background: "var(--sunk)",
                        color: "var(--ink-2)",
                        fontSize: 10.5,
                        fontWeight: 700,
                        flex: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t("settings.types.postIncidentLabel")} :{" "}
                      {t(`settings.types.postIncident.${sv.postIncident}`)}
                    </span>
                    <span style={{ color: "var(--ink-3)", fontSize: 10, flex: "none" }}>
                      {open ? "▴" : "▾"}
                    </span>
                  </Link>
                  {open && (
                    <form
                      action={saveSeverity}
                      className="oi-rise"
                      style={{
                        padding: "14px 18px 16px 47px",
                        background: "var(--sunk)",
                        borderBottom: "1px solid var(--line-2)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <input type="hidden" name="severityId" value={sv.id} />
                      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10 }}>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={label}>{t("settings.types.statusName")}</span>
                          <input
                            name="name"
                            defaultValue={sv.name}
                            required
                            maxLength={20}
                            className="oi-field"
                            style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12 }}
                          />
                        </label>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span style={label}>{t("settings.types.statusDescription")}</span>
                          <input
                            name="description"
                            defaultValue={sv.description ?? ""}
                            maxLength={200}
                            className="oi-field"
                            style={control}
                          />
                        </label>
                      </div>
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
                      >
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                          {t("settings.types.postIncidentEntry")}
                        </span>
                        <select
                          name="postIncident"
                          defaultValue={sv.postIncident}
                          className="oi-field"
                          style={{ ...control, width: "auto", height: 32 }}
                        >
                          {(["always", "yes", "opt_in", "never"] as const).map((v) => (
                            <option key={v} value={v}>
                              {t(`settings.types.postIncident.${v}`)}
                            </option>
                          ))}
                        </select>
                        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                          {t("settings.types.postIncidentHint")}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="submit"
                          style={{
                            height: 32,
                            padding: "0 16px",
                            borderRadius: 9,
                            background: "var(--brand)",
                            color: "var(--on-brand)",
                            border: 0,
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {t("common.save")}
                        </button>
                        <Link
                          href={href({ sev: undefined })}
                          style={{
                            height: 32,
                            padding: "0 12px",
                            border: "1px solid var(--line)",
                            borderRadius: 9,
                            background: "var(--panel)",
                            display: "flex",
                            alignItems: "center",
                            fontSize: 12.5,
                            textDecoration: "none",
                            color: "inherit",
                          }}
                        >
                          {t("common.cancel")}
                        </Link>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
          <div className="oi-note">{t("settings.types.severityNote")}</div>
        </div>
      )}
    </div>
  );
}
