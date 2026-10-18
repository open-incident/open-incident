"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type {
  alertRoutes,
  ConditionGroup,
  EscalationRule,
  GroupingRule,
  IncidentTemplate,
  NotifyRule,
} from "@openincident/db";
import { useT } from "@/i18n/client";
import type { Translate } from "@/i18n/server";
import { ConditionsEditor } from "@/components/alerting/conditions-editor";
import { describeCondition, describeRoute } from "@/lib/route-summary";
import { PREVIEW_ALERTS, type RulePreview } from "@/lib/settings-rule-shape";
import { previewRoute, quickPath, saveRoute } from "./actions";

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

/** A chip of the summary row: what it says, and the section it belongs to. */
function Chip({
  children,
  tone,
  onClick,
  hint,
}: {
  children: React.ReactNode;
  tone: "cond" | "act";
  onClick: () => void;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className="oi-hover-edge"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        border: `1px solid ${tone === "cond" ? "var(--brand-b)" : "var(--line)"}`,
        background: tone === "cond" ? "var(--brand-t)" : "var(--sunk)",
        borderRadius: 8,
        padding: "2px 10px",
        fontWeight: 600,
        fontSize: 13,
        color: tone === "cond" ? "var(--brand)" : "inherit",
        cursor: "pointer",
        lineHeight: 1.6,
        whiteSpace: "nowrap",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

const dashed: React.CSSProperties = {
  border: "1px dashed var(--line)",
  borderRadius: 8,
  padding: "2px 10px",
  fontSize: 12.5,
  color: "var(--ink-3)",
  cursor: "pointer",
  lineHeight: 1.6,
  background: "transparent",
  fontFamily: "inherit",
};

/**
 * One rule, in the card the design draws: the sentence it reads as, the last
 * alerts as this draft would treat them, and — below the fold the design does
 * not draw — every decision the route actually carries.
 *
 * The chip row is a summary, not a second editor. Each chip opens the section
 * that owns the choice: an escalation rule over an attribute or an
 * incident template with its type, severity, visibility and custom fields does
 * not fit in a dropdown, and a chip that pretended otherwise would either lose
 * the choice or lie about it.
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
  cancelHref,
  index,
}: {
  route: RouteRow | null;
  attributes: Array<{ key: string; label: string; type: string }>;
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
  /** Where ✕ and Cancel go back to. */
  cancelHref: string;
  /** The rule's place in the order, for the title — absent for a new one. */
  index?: number;
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
  const [testMode, setTestMode] = useState(route?.testMode ?? false);
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [pending, start] = useTransition();
  const [paths2, setPaths] = useState(paths);
  // Only two attribute types name a row the routing can follow to a policy.
  const routableAttrs = attributes.filter((a) => a.type === "service" || a.type === "team");

  // The sections the chips jump to.
  const condRef = useRef<HTMLElement | null>(null);
  const actRef = useRef<HTMLElement | null>(null);
  const jump = (ref: React.RefObject<HTMLElement | null>) =>
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });

  // `describeRoute` speaks the server's Translate; the client's `t` carries the
  // same dictionary and the same call signature, and the helper only ever calls
  // it — the cast buys the shared vocabulary rather than a second copy of it.
  const tr = t as unknown as Translate;
  const draftRow = {
    sourceIds: allSources ? [] : sourceIds,
    conditions,
    filters: [],
    escalations: rules,
    escalationMode: "none",
    escalationPathId: null,
    incident,
    incidentMode: incident.mode,
  } as unknown as RouteRow;
  const summary = describeRoute(draftRow, tr, { paths: paths2, sources });
  const sentence = `${t("set2.ed.if")} ${summary.when} ${t("set2.ed.then")} ${summary.then}`;

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
          id: route?.id ?? null,
          sourceIds: allSources ? [] : sourceIds,
          conditions,
          escalations: rules,
          incidentMode: incident.mode,
          testMode,
          active: route?.active ?? true,
        }),
      );
    });
  // The design shows the preview open; it is read-only and sends nothing, so
  // it runs as soon as the editor does. The button re-runs it after an edit.
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    runPreview();
  }, [runPreview]);

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
      className="oi-rise-fast"
      style={{
        background: "var(--panel)",
        border: "1.5px solid var(--brand)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card-hover)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
      data-testid="route-form"
    >
      <input type="hidden" name="id" value={route?.id ?? ""} />
      <input type="hidden" name="sourceIds" value={JSON.stringify(allSources ? [] : sourceIds)} />
      <input type="hidden" name="escalations" value={JSON.stringify(rules)} />
      <input type="hidden" name="incident" value={JSON.stringify(incident)} />
      <input type="hidden" name="grouping" value={JSON.stringify(grouping)} />
      <input type="hidden" name="notify" value={JSON.stringify(notify)} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "12px 18px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>
          {route ? t("set2.ed.editTitle", { n: index ?? 1 }) : t("set2.ed.newTitle")}
        </span>
        <span style={{ flex: 1 }} />
        <Link
          href={cancelHref}
          aria-label={t("common.close")}
          className="oi-hover"
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            display: "grid",
            placeItems: "center",
            color: "var(--ink-3)",
            textDecoration: "none",
          }}
        >
          ✕
        </Link>
      </div>

      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* The sentence, as chips. Each opens the section that owns the choice. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            fontSize: 14,
            lineHeight: 2,
          }}
        >
          <span style={{ color: "var(--ink-3)" }}>{t("set2.ed.if")}</span>
          {!allSources && sourceIds.length > 0 && (
            <Chip tone="cond" hint={t("set2.ed.chipHint")} onClick={() => jump(condRef)}>
              {t("routes.fromSources", {
                sources: sourceIds
                  .map((id) => sources.find((s) => s.id === id)?.name ?? "?")
                  .join(", "),
              })}
            </Chip>
          )}
          {conditions
            .flatMap((g, gi) => g.all.map((c, ci) => ({ c, key: `${gi}-${ci}` })))
            .map(({ c, key }, i) => (
              <span key={key} style={{ display: "contents" }}>
                {(i > 0 || (!allSources && sourceIds.length > 0)) && (
                  <span style={{ color: "var(--ink-3)" }}>{t("set2.ed.and")}</span>
                )}
                <Chip tone="cond" hint={t("set2.ed.chipHint")} onClick={() => jump(condRef)}>
                  {describeCondition(c, tr)}
                </Chip>
              </span>
            ))}
          {allSources && conditions.every((g) => g.all.length === 0) && (
            <Chip tone="cond" hint={t("set2.ed.chipHint")} onClick={() => jump(condRef)}>
              {t("set2.ed.everyAlert")}
            </Chip>
          )}
          <button
            type="button"
            onClick={() => jump(condRef)}
            title={t("set2.ed.chipHint")}
            className="oi-hover-edge-ink"
            style={dashed}
          >
            {t("set2.ed.addCond")}
          </button>
          <span style={{ color: "var(--ink-3)", marginLeft: 6 }}>{t("set2.ed.then")}</span>
          <Chip tone="act" hint={t("set2.ed.chipHint")} onClick={() => jump(actRef)}>
            {summary.then}
          </Chip>
          <button
            type="button"
            onClick={() => jump(actRef)}
            title={t("set2.ed.chipHint")}
            className="oi-hover-edge-ink"
            style={dashed}
          >
            {t("set2.ed.addAct")}
          </button>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {t("set2.ed.readsAs", { sentence })}
        </div>

        {/* The last alerts, as this draft would treat them. Nothing is sent. */}
        <div
          data-testid="route-preview"
          style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              background: "var(--sunk)",
              borderBottom: "1px solid var(--line)",
              fontSize: 12.5,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontWeight: 600 }}>
              {t("set2.ed.previewTitle", { count: PREVIEW_ALERTS })}
            </span>
            {preview && (
              <span style={{ color: "var(--ink-3)" }}>
                {t("set2.ed.previewMatches")}{" "}
                <strong style={{ color: "var(--ink)" }}>{preview.matches}</strong> ·{" "}
                <strong style={{ color: "var(--wait)" }}>
                  {t("set2.ed.previewChanges", { count: preview.changes })}
                </strong>
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{t("set2.ed.nothingSent")}</span>
            <button
              type="button"
              onClick={runPreview}
              disabled={pending}
              className="oi-hover"
              style={{ ...btn, height: 26, fontSize: 11.5 }}
              data-testid="route-preview-run"
            >
              {pending ? t("set2.ed.previewRunning") : t("set2.ed.previewRun")}
            </button>
          </div>
          {preview && preview.rows.length === 0 && (
            <div style={{ padding: "12px 14px", fontSize: 12.5, color: "var(--ink-3)" }}>
              {t("set2.ed.previewEmpty")}
            </div>
          )}
          {preview?.rows.map((p) => (
            <div
              key={p.id}
              style={{
                display: "grid",
                gridTemplateColumns: "44px minmax(0,1fr) 250px",
                gap: 12,
                padding: "8px 14px",
                borderBottom: "1px solid var(--line-2)",
                fontSize: 12.5,
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  borderRadius: 5,
                  padding: "1px 0",
                  textAlign: "center",
                  background: p.matched ? "var(--brand-t)" : "var(--sunk)",
                  color: p.priorityColor ?? (p.matched ? "var(--brand)" : "var(--ink-3)"),
                }}
              >
                {p.priority ?? "—"}
              </span>
              <span
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: p.matched ? "var(--ink)" : "var(--ink-2)",
                }}
                title={`${p.title} · ${p.source}`}
              >
                {p.title}
              </span>
              <span
                style={{
                  color: p.changed ? "var(--wait)" : "var(--ink-3)",
                  fontWeight: p.changed ? 600 : 400,
                }}
              >
                {p.changed
                  ? t("set2.ed.changedTo", { before: p.before, after: p.after })
                  : t("set2.ed.unchangedFrom", { before: p.before })}
              </span>
            </div>
          ))}
        </div>

        {/* Everything the chips summarise, and everything they cannot. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            borderTop: "1px solid var(--line-2)",
            paddingTop: 12,
          }}
        >
          <span className="oi-eyebrow">{t("set2.ed.detail")}</span>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("set2.ed.detailHint")}</span>
        </div>

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

        <section ref={condRef} style={card} data-testid="route-conditions">
          <h2 style={h2}>{t("settings.routes.conditions")}</h2>
          <p style={note}>{t("settings.routes.conditionsNote")}</p>
          <ConditionsEditor
            name="conditions"
            initial={initialConditions(route)}
            attributes={attributes.map((a) => ({ key: a.key, label: a.label }))}
            emptyLabel={t("routes.everyAlert")}
          />
        </section>

        <section ref={actRef} style={card} data-testid="route-escalation">
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
                              attribute: routableAttrs[0]?.key ?? "service",
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
                    {routableAttrs.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label} → {a.type}
                      </option>
                    ))}
                    {routableAttrs.length === 0 && (
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
            {routableAttrs.length > 0 && (
              <button
                type="button"
                style={small}
                onClick={() =>
                  setRules((rs) => [
                    ...rs,
                    {
                      kind: "attribute",
                      attribute: routableAttrs[0]!.key,
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
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 18px",
          borderTop: "1px solid var(--line)",
          background: "var(--sunk)",
          flexWrap: "wrap",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 12.5,
            color: "var(--ink-2)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            name="testMode"
            checked={testMode}
            onChange={(e) => setTestMode(e.target.checked)}
            style={{ accentColor: "var(--brand)" }}
          />
          {t("set2.ed.startTest")}
        </label>
        <span style={{ flex: 1 }} />
        <Link
          href={cancelHref}
          className="oi-hover"
          style={{
            height: 32,
            padding: "0 12px",
            border: "1px solid var(--line)",
            borderRadius: 8,
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
          className="oi-hover-brand-2"
          style={{
            height: 32,
            padding: "0 14px",
            borderRadius: 8,
            background: "var(--brand)",
            color: "var(--on-brand)",
            border: 0,
            display: "flex",
            alignItems: "center",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
          data-testid="route-save"
        >
          {t("set2.ed.save")}
        </button>
      </div>
    </form>
  );
}
