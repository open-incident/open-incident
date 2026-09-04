"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useT } from "@/i18n/client";
import { declareIncident, findSimilar } from "./actions";
import { suggestDeclarationAction } from "./ai-actions";

type TypeOpt = {
  id: string;
  name: string;
  isDefault: boolean;
  declareForm: Array<{ key: string; required: boolean }>;
  privateByDefault: boolean;
};
type FieldOpt = {
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[];
  incidentTypeId: string | null;
};

const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" };
const control: React.CSSProperties = {
  height: 40,
  padding: "0 12px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  fontSize: 13.5,
  outline: "none",
  width: "100%",
};

/**
 * The declaration modal of the design: title, the three modes as a segmented
 * control, the similar-incident hint under the title, type and severity side
 * by side, the affected service from the catalog, an optional summary, then
 * the type's own fields. Fields and requirements follow the type.
 */
export function DeclareForm({
  types,
  severities,
  services,
  fields,
  timeZone,
  initial,
  aiSuggest = false,
}: {
  types: TypeOpt[];
  severities: Array<{ id: string; name: string; description: string | null }>;
  services: Array<{ id: string; name: string }>;
  fields: FieldOpt[];
  timeZone: string;
  /** Prefilled from an alert ("Create an incident" on its page); the alert is attached on submit. */
  initial?: {
    alertId: string;
    name: string;
    serviceEntryId: string | null;
    summary: string | null;
  };
  /** Whether the assistant may propose a title and summary (instance configured, workspace and capability on). */
  aiSuggest?: boolean;
}) {
  const t = useT();
  const [pending, start] = useTransition();
  const [typeId, setTypeId] = useState(types.find((x) => x.isDefault)?.id ?? types[0]?.id ?? "");
  const [mode, setMode] = useState<"live" | "retrospective" | "test">("live");
  const [name, setName] = useState(initial?.name ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [similar, setSimilar] = useState<
    Array<{ number: number; name: string; declaredAt: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);

  const type = types.find((x) => x.id === typeId);
  const form = type?.declareForm ?? [];
  const req = (key: string) => form.find((f) => f.key === key)?.required ?? false;
  const shows = (key: string) => form.some((f) => f.key === key);
  const typeFields = useMemo(
    () =>
      fields.filter(
        (f) => (f.incidentTypeId === typeId || f.incidentTypeId === null) && shows(f.key),
      ),
    [fields, typeId, form],
  );

  useEffect(() => {
    const q = name.trim();
    if (q.length < 3) {
      setSimilar([]);
      return;
    }
    const handle = setTimeout(() => {
      findSimilar(q)
        .then(setSimilar)
        .catch(() => setSimilar([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [name]);

  return (
    <form
      ref={formRef}
      data-testid="declare-form"
      action={(fd) => {
        setError(null);
        start(async () => {
          const res = await declareIncident(fd);
          if (res && "error" in res) setError(res.error);
        });
      }}
      className="oi-rise-modal"
      style={{
        width: 580,
        maxWidth: "94vw",
        background: "var(--panel)",
        borderRadius: 18,
        boxShadow: "var(--shadow-modal)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 22px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-title)",
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t("incidents.declare.title")}
        </h1>
        <div
          role="radiogroup"
          aria-label={t("incidents.declare.mode")}
          style={{
            display: "flex",
            gap: 2,
            background: "var(--sunk)",
            borderRadius: 9,
            padding: 3,
            marginLeft: 6,
          }}
        >
          {(["live", "retrospective", "test"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              style={{
                padding: "4px 11px",
                borderRadius: 7,
                border: 0,
                background: mode === m ? "var(--panel)" : "transparent",
                fontSize: 12,
                fontWeight: mode === m ? 600 : 500,
                color: mode === m ? "var(--ink)" : "var(--ink-3)",
                boxShadow: mode === m ? "var(--shadow-card)" : "none",
                cursor: "pointer",
              }}
            >
              {t(`incident.mode.${m}`)}
            </button>
          ))}
        </div>
        <input type="hidden" name="mode" value={mode} />
        <span style={{ flex: 1 }} />
        <Link
          href="/app/incidents"
          aria-label={t("common.close")}
          className="oi-hover"
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            display: "grid",
            placeItems: "center",
            color: "var(--ink-3)",
            fontSize: 15,
            textDecoration: "none",
          }}
        >
          ✕
        </Link>
      </div>

      <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>{t("incidents.declare.name")}</span>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder={t("incidents.declare.namePlaceholder")}
            className="oi-field"
            style={{ ...control, height: 42, borderRadius: 10, fontSize: 14 }}
          />
          {initial && <input type="hidden" name="alertId" value={initial.alertId} />}
        </label>
        {similar.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "var(--viol-t)",
              border: "1px solid var(--viol)",
              borderRadius: 11,
              padding: "10px 13px",
              fontSize: 12.5,
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: 10.5,
                letterSpacing: ".06em",
                color: "var(--viol)",
                background: "var(--panel)",
                borderRadius: 6,
                padding: "2px 7px",
                flex: "none",
              }}
            >
              {t("incidents.declare.similarTag")}
            </span>
            <span style={{ color: "var(--ink-2)", flex: 1 }}>
              <strong>
                INC-{similar[0]!.number} — {similar[0]!.name}
              </strong>{" "}
              {t("incidents.declare.similarOpen", {
                when: t.fmt.relative(new Date(similar[0]!.declaredAt)),
              })}
            </span>
            <Link
              href={`/app/incidents/${similar[0]!.number}`}
              style={{
                height: 28,
                padding: "0 11px",
                border: "1px solid var(--viol)",
                borderRadius: 8,
                background: "var(--panel)",
                display: "flex",
                alignItems: "center",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--viol)",
                textDecoration: "none",
                flex: "none",
              }}
            >
              {t("incidents.declare.join")}
            </Link>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>{t("incidents.declare.type")}</span>
            <select
              name="typeId"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              className="oi-field"
              style={control}
            >
              {types.map((ty) => (
                <option key={ty.id} value={ty.id}>
                  {ty.name}
                </option>
              ))}
            </select>
          </label>
          {shows("severity") && (
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("incidents.declare.severity")}</span>
              <select
                name="severityId"
                required={req("severity")}
                defaultValue={severities[2]?.id ?? severities[0]?.id}
                className="oi-field"
                style={control}
              >
                {severities.map((sv) => (
                  <option key={sv.id} value={sv.id}>
                    {sv.name}
                    {sv.description ? ` — ${sv.description.split(" — ")[0]?.toLowerCase()}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {shows("service") && (
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>
              {t("incidents.declare.service")}{" "}
              <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>
                — {t("incidents.declare.fromCatalog")}
              </span>
            </span>
            <select
              name="serviceEntryId"
              required={req("service")}
              defaultValue={initial?.serviceEntryId ?? ""}
              className="oi-field"
              style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12.5 }}
            >
              <option value="">—</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {shows("summary") && (
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ ...label, display: "flex", alignItems: "center", gap: 6 }}>
              <span>
                {t("incidents.declare.summary")}{" "}
                <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>
                  — {t("common.optional")}
                </span>
              </span>
              <span style={{ flex: 1 }} />
              {aiSuggest && (
                <button
                  type="button"
                  data-testid="ai-suggest-declare"
                  title={t("ai.declare.note")}
                  disabled={suggesting || name.trim().length < 3}
                  onClick={async () => {
                    setSuggesting(true);
                    setSuggestError(null);
                    const fd = formRef.current ? new FormData(formRef.current) : null;
                    const out = await suggestDeclarationAction({
                      name,
                      summary,
                      serviceEntryId: (fd?.get("serviceEntryId") as string | null) || null,
                    });
                    if ("error" in out) setSuggestError(out.error);
                    else {
                      setName(out.value.title);
                      setSummary(out.value.summary);
                    }
                    setSuggesting(false);
                  }}
                  style={{
                    background: "none",
                    border: 0,
                    padding: 0,
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "var(--viol)",
                    cursor: "pointer",
                    opacity: suggesting || name.trim().length < 3 ? 0.5 : 1,
                  }}
                >
                  ✦ {suggesting ? t("ai.working") : t("ai.declare.suggest")}
                </button>
              )}
              {suggestError && (
                <span
                  role="alert"
                  style={{ fontSize: 11.5, color: "var(--dang)", fontWeight: 400 }}
                >
                  {suggestError}
                </span>
              )}
            </span>
            <textarea
              name="summary"
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={t("incidents.declare.summaryPlaceholder")}
              className="oi-field"
              style={{
                ...control,
                height: "auto",
                padding: "10px 13px",
                borderRadius: 10,
                resize: "vertical",
                lineHeight: 1.6,
              }}
            />
          </label>
        )}
        {typeFields.map((f) => (
          <label key={f.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>
              <span
                style={{ fontFamily: /^[a-z_]+$/.test(f.label) ? "var(--font-mono)" : undefined }}
              >
                {f.label}
              </span>
              {!req(f.key) && (
                <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>
                  {" "}
                  — {t("common.optional")}
                </span>
              )}
            </span>
            {f.type === "select" ? (
              <select
                name={`field.${f.key}`}
                required={req(f.key)}
                defaultValue=""
                className="oi-field"
                style={control}
              >
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : f.type === "long_text" ? (
              <textarea
                name={`field.${f.key}`}
                required={req(f.key)}
                rows={3}
                className="oi-field"
                style={{
                  ...control,
                  height: "auto",
                  padding: "10px 13px",
                  borderRadius: 10,
                  resize: "vertical",
                }}
              />
            ) : (
              <input
                name={`field.${f.key}`}
                required={req(f.key)}
                type={f.type === "number" ? "number" : f.type === "link" ? "url" : "text"}
                className="oi-field"
                style={control}
              />
            )}
          </label>
        ))}
        {mode === "retrospective" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>{t("incidents.declare.startedAt", { timeZone })}</span>
            <input
              name="declaredAt"
              type="datetime-local"
              required
              className="oi-field"
              style={control}
            />
          </label>
        )}
        {error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: "10px 12px",
              borderRadius: 10,
              background: "var(--dang-t)",
              border: "1px solid var(--dang)",
              color: "var(--dang)",
              fontSize: 13,
            }}
          >
            {error}
          </p>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 22px",
          borderTop: "1px solid var(--line)",
          background: "var(--canvas)",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {type?.privateByDefault
            ? t("incidents.declare.privateNote")
            : t("incidents.declare.footer")}
        </span>
        <span style={{ flex: 1 }} />
        <Link
          href="/app/incidents"
          style={{
            height: 36,
            padding: "0 14px",
            border: "1px solid var(--line)",
            borderRadius: 9,
            background: "var(--panel)",
            display: "flex",
            alignItems: "center",
            fontSize: 13.5,
            fontWeight: 500,
            color: "inherit",
            textDecoration: "none",
          }}
        >
          {t("common.cancel")}
        </Link>
        <button
          type="submit"
          disabled={pending}
          style={{
            height: 36,
            padding: "0 16px",
            borderRadius: 9,
            background: "var(--brand)",
            color: "#fff",
            border: 0,
            fontSize: 13.5,
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? t("common.saving") : t("incidents.declare.submit")}
        </button>
      </div>
    </form>
  );
}
