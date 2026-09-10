"use client";

import { useState, useTransition } from "react";
import type {
  alertRoutes,
  ConditionGroup,
  EscalationRule,
  GroupingRule,
  IncidentTemplate,
  NotifyRule,
} from "@openincident/db";
import { useT } from "@/i18n/client";
import { ConditionsEditor } from "@/components/alerting/conditions-editor";
import { previewRoute, quickPath, saveRoute, type RoutePreviewRow } from "../actions";

type RouteRow = typeof alertRoutes.$inferSelect;
type Named = { id: string; name: string };

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 13,
  boxShadow: "var(--shadow-card)",
  padding: "14px 18px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const h2: React.CSSProperties = { margin: 0, fontSize: 14, fontWeight: 600 };
const note: React.CSSProperties = {
  margin: 0,
  fontSize: 12.5,
  color: "var(--ink-3)",
  lineHeight: 1.5,
};
const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
const control: React.CSSProperties = {
  height: 32,
  padding: "0 9px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 12.5,
  outline: "none",
};
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
};
const small: React.CSSProperties = {
  background: "none",
  border: 0,
  padding: "2px 6px",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--brand)",
  cursor: "pointer",
};
const radio = (checked: boolean, onChange: () => void, text: string) => (
  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
    <input type="radio" checked={checked} onChange={onChange} />
    {text}
  </label>
);
const check = (checked: boolean, onChange: (v: boolean) => void, text: string) => (
  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    {text}
  </label>
);

const DEFAULT_INCIDENT: IncidentTemplate = {
  mode: "conditional",
  typeId: null,
  startPhase: "triage",
  severity: { mode: "priority" },
  visibility: "public",
  customFields: {},
  declineOnResolve: true,
};
const DEFAULT_GROUPING: GroupingRule = {
  enabled: true,
  by: ["service"],
  windowMinutes: 5,
  extending: true,
  escalate: "never",
  graceMinutes: 0,
};

/** What a legacy route meant, so the editor opens on the truth. */
function initialRules(r: RouteRow | null): EscalationRule[] {
  if (!r) return [];
  if (r.escalations.length) return r.escalations;
  if (r.escalationMode === "static" && r.escalationPathId)
    return [{ kind: "path", pathId: r.escalationPathId }];
  if (r.escalationMode === "dynamic")
    return [{ kind: "attribute", attribute: "service", fallbackPathId: r.escalationPathId }];
  return [];
}
function initialConditions(r: RouteRow | null): ConditionGroup[] {
  if (!r) return [];
  if (r.conditions.length) return r.conditions;
  return r.filters.length ? [{ all: r.filters.map((f) => ({ ...f })) }] : [];
}

/**
 * One route, every decision on one page: which sources, which alerts (the
 * conditions), who to page (rules that stack — a path, a person or a schedule
 * in one click, or the path a catalog attribute leads to), the incident it
 * opens, how it groups, where it posts, and how it behaves. On the right, the
 * last alerts as this draft would treat them — before saving.
 */
export function RouteEditor({
  route,
  attributes,
  sources,
  paths,
  types,
  severities,
  priorities,
  fields,
  people,
  schedules,
  slackInstalled,
  channels,
}: {
  route: RouteRow | null;
  attributes: Array<{ key: string; label: string; type: string; catalogTypeKey: string | null }>;
  sources: Array<Named & { kind: string }>;
  paths: Array<Named & { published: boolean }>;
  types: Array<Named & { isDefault: boolean }>;
  severities: Named[];
  priorities: Array<Named & { isDefault: boolean }>;
  fields: Array<{ key: string; label: string }>;
  people: Named[];
  schedules: Named[];
  slackInstalled: boolean;
  channels: Named[];
}) {
  const t = useT();
  const [allSources, setAllSources] = useState((route?.sourceIds.length ?? 0) === 0);
  const [sourceIds, setSourceIds] = useState<string[]>(route?.sourceIds ?? []);
  const [conditions, setConditions] = useState<ConditionGroup[]>(initialConditions(route));
  const [rules, setRules] = useState<EscalationRule[]>(initialRules(route));
  const [incident, setIncident] = useState<IncidentTemplate>(
    route?.incident ??
      (route
        ? {
            ...DEFAULT_INCIDENT,
            mode: route.incidentMode,
            typeId: route.incidentTypeId,
            startPhase: route.incidentMode === "always" ? "active" : "triage",
          }
        : DEFAULT_INCIDENT),
  );
  const [grouping, setGrouping] = useState<GroupingRule>(route?.grouping ?? DEFAULT_GROUPING);
  const [notify, setNotify] = useState<NotifyRule>(
    route?.notify ?? { slackChannelId: null, slackChannelName: null },
  );
  const [preview, setPreview] = useState<RoutePreviewRow[] | null>(null);
  const [pending, start] = useTransition();
  const [paths2, setPaths] = useState(paths);
  const catalogAttrs = attributes.filter((a) => a.type === "catalog");
  const pathName = (id: string | null) => paths2.find((p) => p.id === id)?.name ?? "?";

  const addQuick = (target: Parameters<typeof quickPath>[0]) =>
    start(async () => {
      const r = await quickPath(target);
      if ("error" in r) return;
      setPaths((ps) =>
        ps.some((p) => p.id === r.id) ? ps : [...ps, { id: r.id, name: r.name, published: true }],
      );
      setRules((rs) =>
        rs.some((x) => x.kind === "path" && x.pathId === r.id)
          ? rs
          : [...rs, { kind: "path", pathId: r.id }],
      );
    });
  const runPreview = () =>
    start(async () => {
      setPreview(
        await previewRoute({
          sourceIds: allSources ? [] : sourceIds,
          conditions,
          escalations: rules,
        }),
      );
    });

  // The conditions editor keeps its own state and writes a hidden field; the
  // preview reads the same value through this listener.
  const onConditionsChange = (e: React.FormEvent<HTMLFormElement>) => {
    const raw = (e.currentTarget.elements.namedItem("conditions") as HTMLInputElement | null)
      ?.value;
    if (raw) {
      try {
        setConditions(JSON.parse(raw));
      } catch {
        /* keep the last good value */
      }
    }
  };

  return (
    <form
      action={saveRoute}
      onChange={onConditionsChange}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 320px",
        gap: 14,
        alignItems: "start",
      }}
      data-testid="route-form"
    >
      <input type="hidden" name="id" value={route?.id ?? ""} />
      <input type="hidden" name="sourceIds" value={JSON.stringify(allSources ? [] : sourceIds)} />
      <input type="hidden" name="escalations" value={JSON.stringify(rules)} />
      <input type="hidden" name="incident" value={JSON.stringify(incident)} />
      <input type="hidden" name="grouping" value={JSON.stringify(grouping)} />
      <input type="hidden" name="notify" value={JSON.stringify(notify)} />

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <section style={card}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={label}>{t("settings.routes.name")}</span>
              <input
                name="name"
                required
                minLength={2}
                maxLength={80}
                defaultValue={route?.name ?? ""}
                placeholder={t("settings.routes.namePlaceholder")}
                className="oi-field"
                style={{ ...control, fontWeight: 600 }}
                data-testid="route-name"
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={label}>{t("settings.routes.description")}</span>
              <input
                name="description"
                maxLength={300}
                defaultValue={route?.description ?? ""}
                className="oi-field"
                style={control}
              />
            </label>
          </div>
        </section>

        <section style={card} data-testid="route-sources">
          <h2 style={h2}>{t("settings.routes.sources")}</h2>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {radio(allSources, () => setAllSources(true), t("settings.routes.sourcesAll"))}
            {radio(!allSources, () => setAllSources(false), t("settings.routes.sourcesSome"))}
          </div>
          {!allSources && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {sources.map((s) => (
                <label
                  key={s.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12.5,
                    border: "1px solid var(--line)",
                    borderRadius: 999,
                    padding: "4px 10px",
                    cursor: "pointer",
                    background: sourceIds.includes(s.id) ? "var(--brand-t)" : "var(--panel)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={sourceIds.includes(s.id)}
                    onChange={(e) =>
                      setSourceIds((ids) =>
                        e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id),
                      )
                    }
                  />
                  {s.name}
                </label>
              ))}
              {sources.length === 0 && <span style={note}>{t("settings.sources.empty")}</span>}
            </div>
          )}
        </section>

        <section style={card} data-testid="route-conditions">
          <h2 style={h2}>{t("settings.routes.conditions")}</h2>
          <p style={note}>{t("settings.routes.conditionsNote")}</p>
          <ConditionsEditor
            name="conditions"
            initial={initialConditions(route)}
            attributes={attributes.map((a) => ({ key: a.key, label: a.label }))}
            emptyLabel={t("routes.everyAlert")}
          />
        </section>

        <section style={card} data-testid="route-escalation">
          <h2 style={h2}>{t("settings.routes.escalation")}</h2>
          <p style={note}>{t("settings.routes.escalationNote")}</p>
          {rules.length === 0 && (
            <p style={{ ...note, color: "var(--wait)", fontWeight: 600 }}>
              {t("routes.pageNobody")}
            </p>
          )}
          {rules.map((rule, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                padding: "8px 10px",
                border: "1px solid var(--line)",
                borderRadius: 10,
                background: "var(--sunk)",
              }}
              data-testid="route-rule"
            >
              <select
                value={rule.kind}
                onChange={(e) =>
                  setRules((rs) =>
                    rs.map((x, j) =>
                      j !== i
                        ? x
                        : e.target.value === "path"
                          ? { kind: "path", pathId: paths2[0]?.id ?? "" }
                          : {
                              kind: "attribute",
                              attribute: catalogAttrs[0]?.key ?? "service",
                              fallbackPathId: null,
                            },
                    ),
                  )
                }
                style={control}
              >
                <option value="path">{t("settings.routes.rulePath")}</option>
                <option value="attribute">{t("settings.routes.ruleAttribute")}</option>
              </select>
              {rule.kind === "path" ? (
                <select
                  value={rule.pathId}
                  onChange={(e) =>
                    setRules((rs) =>
                      rs.map((x, j) => (j === i ? { kind: "path", pathId: e.target.value } : x)),
                    )
                  }
                  style={{ ...control, minWidth: 220 }}
                >
                  {paths2.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.published ? "" : ` · ${t("settings.routes.unpublished")}`}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <select
                    value={rule.attribute}
                    onChange={(e) =>
                      setRules((rs) =>
                        rs.map((x, j) =>
                          j === i && x.kind === "attribute"
                            ? { ...x, attribute: e.target.value }
                            : x,
                        ),
                      )
                    }
                    style={control}
                  >
                    {catalogAttrs.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label} → {a.catalogTypeKey}
                      </option>
                    ))}
                    {catalogAttrs.length === 0 && (
                      <option value={rule.attribute}>{rule.attribute}</option>
                    )}
                  </select>
                  <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                    {t("settings.routes.fallback")}
                  </span>
                  <select
                    value={rule.fallbackPathId ?? ""}
                    onChange={(e) =>
                      setRules((rs) =>
                        rs.map((x, j) =>
                          j === i && x.kind === "attribute"
                            ? { ...x, fallbackPathId: e.target.value || null }
                            : x,
                        ),
                      )
                    }
                    style={{ ...control, minWidth: 180 }}
                  >
                    <option value="">{t("routes.noFallback")}</option>
                    {paths2.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                style={{ ...small, color: "var(--ink-3)" }}
                aria-label={t("common.delete")}
              >
                ✕
              </button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => addQuick({ kind: "me" })}
              disabled={pending}
              style={{ ...btn, color: "var(--brand)" }}
              data-testid="route-page-me"
            >
              {t("setup.pageMe")}
            </button>
            {schedules.length > 0 && (
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) addQuick({ kind: "schedule", scheduleId: e.target.value });
                  e.target.value = "";
                }}
                style={control}
              >
                <option value="" disabled>
                  {t("setup.pageSchedule")}
                </option>
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            {people.length > 0 && (
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) addQuick({ kind: "member", memberId: e.target.value });
                  e.target.value = "";
                }}
                style={control}
              >
                <option value="" disabled>
                  {t("setup.pageSomeone")}
                </option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            {paths2.length > 0 && (
              <button
                type="button"
                style={small}
                onClick={() => setRules((rs) => [...rs, { kind: "path", pathId: paths2[0]!.id }])}
              >
                + {t("settings.routes.addPathRule")}
              </button>
            )}
            {catalogAttrs.length > 0 && (
              <button
                type="button"
                style={small}
                onClick={() =>
                  setRules((rs) => [
                    ...rs,
                    {
                      kind: "attribute",
                      attribute: catalogAttrs[0]!.key,
                      fallbackPathId: paths2[0]?.id ?? null,
                    },
                  ])
                }
              >
                + {t("settings.routes.addAttributeRule")}
              </button>
            )}
          </div>
        </section>

        <section style={card} data-testid="route-incident">
          <h2 style={h2}>{t("settings.routes.incident.title")}</h2>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {radio(
              incident.mode === "conditional",
              () => setIncident({ ...incident, mode: "conditional" }),
              t("settings.routes.incident.conditional"),
            )}
            {radio(
              incident.mode === "always",
              () => setIncident({ ...incident, mode: "always" }),
              t("settings.routes.incident.alwaysShort"),
            )}
            {radio(
              incident.mode === "never",
              () => setIncident({ ...incident, mode: "never" }),
              t("settings.routes.incident.never"),
            )}
          </div>
          {incident.mode !== "never" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={label}>{t("settings.routes.incidentType")}</span>
                <select
                  value={incident.typeId ?? ""}
                  onChange={(e) => setIncident({ ...incident, typeId: e.target.value || null })}
                  style={control}
                >
                  <option value="">{t("settings.routes.incidentTypeDefault")}</option>
                  {types.map((ty) => (
                    <option key={ty.id} value={ty.id}>
                      {ty.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={label}>{t("settings.routes.startPhase")}</span>
                <select
                  value={incident.startPhase}
                  onChange={(e) =>
                    setIncident({ ...incident, startPhase: e.target.value as "triage" | "active" })
                  }
                  style={control}
                >
                  <option value="triage">{t("settings.routes.startTriage")}</option>
                  <option value="active">{t("settings.routes.startActive")}</option>
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={label}>{t("settings.routes.severity")}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <select
                    value={incident.severity.mode}
                    onChange={(e) =>
                      setIncident({
                        ...incident,
                        severity:
                          e.target.value === "static"
                            ? { mode: "static", severityId: severities[0]?.id ?? null }
                            : e.target.value === "none"
                              ? { mode: "none" }
                              : { mode: "priority" },
                      })
                    }
                    style={control}
                  >
                    <option value="priority">{t("settings.routes.severityFromPriority")}</option>
                    <option value="static">{t("settings.routes.severityStatic")}</option>
                    <option value="none">{t("settings.routes.severityNone")}</option>
                  </select>
                  {incident.severity.mode === "static" && (
                    <select
                      value={incident.severity.severityId ?? ""}
                      onChange={(e) =>
                        setIncident({
                          ...incident,
                          severity: { mode: "static", severityId: e.target.value || null },
                        })
                      }
                      style={control}
                    >
                      {severities.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 16, flexWrap: "wrap" }}>
                {check(
                  incident.visibility === "private",
                  (v) => setIncident({ ...incident, visibility: v ? "private" : "public" }),
                  t("settings.routes.privateIncident"),
                )}
                {check(
                  incident.declineOnResolve,
                  (v) => setIncident({ ...incident, declineOnResolve: v }),
                  t("settings.routes.declineOnResolve"),
                )}
              </div>
              {fields.length > 0 && (
                <div
                  style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <span style={label}>{t("settings.routes.customFields")}</span>
                  {Object.entries(incident.customFields).map(([fieldKey, attr]) => (
                    <div key={fieldKey} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, width: 180 }}>
                        {fields.find((f) => f.key === fieldKey)?.label ?? fieldKey}
                      </span>
                      <span style={{ color: "var(--ink-3)" }}>←</span>
                      <select
                        value={attr}
                        onChange={(e) =>
                          setIncident({
                            ...incident,
                            customFields: { ...incident.customFields, [fieldKey]: e.target.value },
                          })
                        }
                        style={control}
                      >
                        {attributes.map((a) => (
                          <option key={a.key} value={a.key}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          const cf = { ...incident.customFields };
                          delete cf[fieldKey];
                          setIncident({ ...incident, customFields: cf });
                        }}
                        style={{ ...small, color: "var(--ink-3)" }}
                        aria-label={t("common.delete")}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value)
                        setIncident({
                          ...incident,
                          customFields: {
                            ...incident.customFields,
                            [e.target.value]: attributes[0]?.key ?? "service",
                          },
                        });
                      e.target.value = "";
                    }}
                    style={{ ...control, maxWidth: 260 }}
                  >
                    <option value="">{t("settings.routes.addCustomField")}</option>
                    {fields
                      .filter((f) => !(f.key in incident.customFields))
                      .map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </section>

        <section style={card} data-testid="route-grouping">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={h2}>{t("settings.routes.grouping.title")}</h2>
            <span style={{ flex: 1 }} />
            {check(
              grouping.enabled,
              (v) => setGrouping({ ...grouping, enabled: v }),
              t("settings.routes.grouping.enabled"),
            )}
          </div>
          <p style={note}>{t("settings.routes.grouping.note")}</p>
          {grouping.enabled && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={label}>{t("settings.routes.grouping.by")}</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {attributes.map((a) => (
                    <label
                      key={a.key}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 12.5,
                        border: "1px solid var(--line)",
                        borderRadius: 999,
                        padding: "3px 9px",
                        cursor: "pointer",
                        background: grouping.by.includes(a.key) ? "var(--brand-t)" : "var(--panel)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={grouping.by.includes(a.key)}
                        onChange={(e) =>
                          setGrouping({
                            ...grouping,
                            by: e.target.checked
                              ? [...grouping.by, a.key]
                              : grouping.by.filter((k) => k !== a.key),
                          })
                        }
                      />
                      {a.label}
                    </label>
                  ))}
                </div>
                <span style={note}>
                  {grouping.by.length === 0 ? t("settings.routes.grouping.byNone") : ""}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={label}>{t("settings.routes.grouping.window")}</span>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={grouping.windowMinutes}
                    onChange={(e) =>
                      setGrouping({ ...grouping, windowMinutes: Number(e.target.value) || 5 })
                    }
                    style={control}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={label}>{t("settings.routes.grouping.escalate")}</span>
                  <select
                    value={grouping.escalate}
                    onChange={(e) =>
                      setGrouping({
                        ...grouping,
                        escalate: e.target.value as GroupingRule["escalate"],
                      })
                    }
                    style={control}
                  >
                    <option value="never">{t("settings.routes.grouping.escalateNever")}</option>
                    <option value="every">{t("settings.routes.grouping.escalateEvery")}</option>
                    <option value="increase">
                      {t("settings.routes.grouping.escalateIncrease")}
                    </option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={label}>{t("settings.routes.grouping.grace")}</span>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={grouping.graceMinutes}
                    onChange={(e) =>
                      setGrouping({ ...grouping, graceMinutes: Number(e.target.value) || 0 })
                    }
                    style={control}
                  />
                </label>
                <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 6 }}>
                  {check(
                    grouping.extending,
                    (v) => setGrouping({ ...grouping, extending: v }),
                    t("settings.routes.grouping.extending"),
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <section style={card} data-testid="route-notify">
          <h2 style={h2}>{t("settings.routes.notify.title")}</h2>
          {slackInstalled ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={notify.slackChannelId ?? ""}
                onChange={(e) =>
                  setNotify({
                    slackChannelId: e.target.value || null,
                    slackChannelName: channels.find((c) => c.id === e.target.value)?.name ?? null,
                  })
                }
                style={{ ...control, minWidth: 240 }}
              >
                <option value="">{t("settings.routes.notify.none")}</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
              <span style={note}>{t("settings.routes.notify.note")}</span>
            </div>
          ) : (
            <p style={note}>{t("settings.routes.notify.noSlack")}</p>
          )}
        </section>

        <section style={card} data-testid="route-options">
          <h2 style={h2}>{t("settings.routes.options")}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={label}>{t("settings.routes.priority")}</span>
              <select name="priorityId" defaultValue={route?.priorityId ?? ""} style={control}>
                <option value="">{t("settings.routes.priorityFromSource")}</option>
                {priorities.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isDefault ? ` · ${t("settings.priorities.default")}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={label}>{t("settings.routes.urgency")}</span>
              <select
                name="urgencyOverride"
                defaultValue={route?.urgencyOverride ?? ""}
                style={control}
              >
                <option value="">{t("settings.routes.urgencyFromPriority")}</option>
                <option value="high">{t("settings.priorities.urgencyHigh")}</option>
                <option value="low">{t("settings.priorities.urgencyLow")}</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={label}>{t("settings.routes.defer")}</span>
              <select
                name="deferMinutes"
                defaultValue={String(route?.deferMinutes ?? 0)}
                style={control}
              >
                {[0, 1, 2, 5, 10, 15, 30].map((m) => (
                  <option key={m} value={m}>
                    {m === 0
                      ? t("settings.routes.deferNone")
                      : t("settings.routes.deferMinutes", { count: m })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="hidden" name="resolveClosesEscalation" value="off" />
              <input
                type="checkbox"
                name="resolveClosesEscalation"
                value="on"
                defaultChecked={route?.resolveClosesEscalation ?? true}
              />
              {t("settings.routes.autoCancel")}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" name="testMode" defaultChecked={route?.testMode ?? false} />
              {t("settings.routes.testModeLabel")}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="hidden" name="active" value="off" />
              <input
                type="checkbox"
                name="active"
                value="on"
                defaultChecked={route?.active ?? true}
              />
              {t("settings.routes.activeLabel")}
            </label>
          </div>
        </section>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="submit"
            style={{
              ...btn,
              height: 34,
              background: "var(--brand)",
              borderColor: "var(--brand)",
              color: "#fff",
            }}
            data-testid="route-save"
          >
            {t("common.save")}
          </button>
        </div>
      </div>

      <aside style={{ ...card, position: "sticky", top: 0 }} data-testid="route-preview">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={h2}>{t("settings.routes.preview.title")}</h2>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={runPreview}
            disabled={pending}
            style={btn}
            data-testid="route-preview-run"
          >
            {t("settings.routes.preview.run")}
          </button>
        </div>
        <p style={note}>{t("settings.routes.preview.note")}</p>
        {preview?.length === 0 && <p style={note}>{t("settings.routes.preview.noAlerts")}</p>}
        {preview?.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              fontSize: 12.5,
              paddingTop: 6,
              borderTop: "1px solid var(--line-2)",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                marginTop: 5,
                flex: "none",
                background: p.matched ? "var(--ok)" : "var(--line)",
              }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  fontWeight: p.matched ? 600 : 400,
                  color: p.matched ? "var(--ink)" : "var(--ink-3)",
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {p.title}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {p.source} · {new Date(p.when).toLocaleString()}
                {p.matched
                  ? ` · ${p.paths.length ? t("settings.routes.preview.pages", { paths: p.paths.map(pathName).join(", ") }) : t("routes.pageNobody")}`
                  : ` · ${t("settings.routes.preview.skips")}`}
              </span>
            </span>
          </div>
        ))}
      </aside>
    </form>
  );
}
