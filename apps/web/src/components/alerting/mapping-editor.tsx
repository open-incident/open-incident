"use client";

import { useMemo, useState } from "react";
import type { AttributeMapping, MappingTransform } from "@openincident/db";
import { payloadPaths, resolveMapping, suggestMappings } from "@openincident/oncall/routing";
import { useT } from "@/i18n/client";
import { saveSourceMappings } from "@/app/app/settings/alert-sources/actions";

export type Sample = { id: string; title: string; payload: unknown; testMode: boolean };
export type AttributeOption = { key: string; label: string; type: string; required: boolean };

const TRANSFORMS: Array<MappingTransform | ""> = [
  "",
  "lower",
  "upper",
  "after_colon",
  "before_colon",
  "first_word",
];

const control: React.CSSProperties = {
  height: 32,
  padding: "0 9px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 12.5,
  outline: "none",
  minWidth: 0,
  width: "100%",
};
const mono: React.CSSProperties = { ...control, fontFamily: "var(--font-mono)", fontSize: 11.5 };
const small: React.CSSProperties = {
  background: "none",
  border: 0,
  padding: "2px 6px",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--brand)",
  cursor: "pointer",
};

/**
 * Where each attribute comes from in this source's payload: a path picked
 * from a real alert the source sent, a light transform, a guard, a static
 * value — and, for every row, the value that would come out of the sample
 * on the right. Suggestions read the payload for the usual field names.
 */
export function MappingEditor({
  sourceId,
  initial,
  attributes,
  samples,
}: {
  sourceId: string;
  initial: AttributeMapping[];
  attributes: AttributeOption[];
  samples: Sample[];
}) {
  const t = useT();
  const [rows, setRows] = useState<AttributeMapping[]>(initial);
  const [sampleId, setSampleId] = useState(samples[0]?.id ?? "");
  const sample = samples.find((s) => s.id === sampleId) ?? samples[0] ?? null;
  const paths = useMemo(() => (sample ? payloadPaths(sample.payload) : []), [sample]);
  const update = (i: number, patch: Partial<AttributeMapping>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const unmapped = attributes.filter((a) => !rows.some((r) => r.attribute === a.key));
  const suggest = () => {
    if (!sample) return;
    const s = suggestMappings(
      sample.payload,
      unmapped.map((a) => a.key),
    );
    if (s.length)
      setRows((r) => [...r, ...s.map((x) => ({ attribute: x.attribute, path: x.path }))]);
  };
  return (
    <form
      action={saveSourceMappings}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
      data-testid="mapping-editor"
    >
      <input type="hidden" name="id" value={sourceId} />
      <input type="hidden" name="mappings" value={JSON.stringify(rows)} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {t("settings.sources.mapping.sample")}
        </span>
        {samples.length > 0 ? (
          <select
            value={sampleId}
            onChange={(e) => setSampleId(e.target.value)}
            style={{ ...control, width: "auto", maxWidth: 340 }}
          >
            {samples.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title.slice(0, 60)}
                {s.testMode ? ` · ${t("alerts.testMode")}` : ""}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontStyle: "italic" }}>
            {t("settings.sources.mapping.noSample")}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {sample && unmapped.length > 0 && (
          <button type="button" style={small} onClick={suggest} data-testid="mapping-suggest">
            ✦ {t("settings.sources.mapping.suggest")}
          </button>
        )}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(0,1.1fr) minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) auto",
          gap: 6,
          fontSize: 11,
          fontWeight: 600,
          color: "var(--ink-3)",
          letterSpacing: ".02em",
        }}
      >
        <span>{t("settings.sources.mapping.attribute")}</span>
        <span>{t("settings.sources.mapping.path")}</span>
        <span>{t("settings.sources.mapping.transform")}</span>
        <span>{t("settings.sources.mapping.match")}</span>
        <span>{t("settings.sources.mapping.preview")}</span>
        <span />
      </div>
      {rows.map((m, i) => {
        const preview = sample ? resolveMapping(sample.payload, m) : null;
        const def = attributes.find((a) => a.key === m.attribute);
        return (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(0,1.1fr) minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) auto",
              gap: 6,
              alignItems: "center",
            }}
            data-testid="mapping-row"
          >
            <select
              value={m.attribute}
              onChange={(e) => update(i, { attribute: e.target.value })}
              style={control}
            >
              {!def && <option value={m.attribute}>{m.attribute}</option>}
              {attributes.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                  {a.required ? " *" : ""}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 4, minWidth: 0 }}>
              <input
                value={m.path}
                onChange={(e) => update(i, { path: e.target.value })}
                placeholder={m.value ? t("settings.sources.mapping.staticHint") : "labels.service"}
                style={mono}
                list={`paths-${sourceId}`}
              />
              <input
                value={m.value ?? ""}
                onChange={(e) => update(i, { value: e.target.value || undefined })}
                placeholder={t("settings.sources.mapping.static")}
                title={t("settings.sources.mapping.staticTitle")}
                style={{ ...mono, width: 90, flex: "none" }}
              />
            </div>
            <select
              value={m.transform ?? ""}
              onChange={(e) =>
                update(i, {
                  transform: (e.target.value || undefined) as MappingTransform | undefined,
                })
              }
              style={control}
            >
              {TRANSFORMS.map((tr) => (
                <option key={tr} value={tr}>
                  {tr
                    ? t(`settings.sources.transform.${tr}`)
                    : t("settings.sources.transform.none")}
                </option>
              ))}
            </select>
            <input
              value={m.match ?? ""}
              onChange={(e) => update(i, { match: e.target.value || undefined })}
              placeholder="^prod"
              style={mono}
            />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                padding: "6px 8px",
                borderRadius: 8,
                background: preview ? "var(--ok-t)" : "var(--sunk)",
                color: preview ? "var(--ok)" : "var(--ink-3)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={preview ?? undefined}
              data-testid="mapping-preview"
            >
              {preview ?? (sample ? t("settings.sources.mapping.nothing") : "—")}
            </span>
            <button
              type="button"
              aria-label={t("common.delete")}
              onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
              style={{ ...small, color: "var(--ink-3)" }}
            >
              ✕
            </button>
          </div>
        );
      })}
      <datalist id={`paths-${sourceId}`}>
        {paths.map((p) => (
          <option key={p.path} value={p.path}>
            {p.value}
          </option>
        ))}
      </datalist>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          style={small}
          onClick={() =>
            setRows((r) => [
              ...r,
              { attribute: unmapped[0]?.key ?? attributes[0]?.key ?? "service", path: "" },
            ])
          }
          data-testid="mapping-add"
        >
          + {t("settings.sources.mapping.add")}
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="submit"
          className="oi-hover"
          style={{
            height: 30,
            padding: "0 12px",
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--panel)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
          data-testid="mapping-save"
        >
          {t("common.save")}
        </button>
      </div>
      {paths.length > 0 && (
        <details>
          <summary style={{ fontSize: 12, color: "var(--ink-3)", cursor: "pointer" }}>
            {t("settings.sources.mapping.fields", { count: paths.length })}
          </summary>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 4,
              marginTop: 6,
              maxHeight: 220,
              overflow: "auto",
            }}
          >
            {paths.map((p) => (
              <button
                key={p.path}
                type="button"
                onClick={() =>
                  setRows((r) => [...r, { attribute: unmapped[0]?.key ?? "service", path: p.path }])
                }
                className="oi-hover"
                style={{
                  textAlign: "left",
                  background: "none",
                  border: "1px solid var(--line-2)",
                  borderRadius: 6,
                  padding: "3px 7px",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  cursor: "pointer",
                  color: "var(--ink-2)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={t("settings.sources.mapping.useField")}
              >
                {p.path} <span style={{ color: "var(--ink-3)" }}>= {p.value}</span>
              </button>
            ))}
          </div>
        </details>
      )}
    </form>
  );
}
