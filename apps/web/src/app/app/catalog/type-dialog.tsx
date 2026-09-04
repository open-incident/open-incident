"use client";

import { useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import type { CatalogAttributeDef, CatalogAttributeType } from "@openincident/db";
import { keyify } from "@openincident/catalog/spec";
import { createType, deleteType, updateType } from "./actions";
import * as s from "./dialog-styles";
import { useEscape } from "./use-escape";
import type { TypeOpt } from "./entry-dialog";

type Row = {
  key: string;
  label: string;
  type: CatalogAttributeType;
  refTypeKey: string;
  options: string;
  /** An attribute that already exists keeps its key and kind. */
  existing: boolean;
};

const KINDS: CatalogAttributeType[] = ["text", "link", "select", "entry", "member_list"];

function rowsOf(defs: CatalogAttributeDef[]): Row[] {
  return defs.map((d) => ({
    key: d.key,
    label: d.label,
    type: d.type,
    refTypeKey: d.refTypeKey ?? "",
    options: (d.options ?? []).join(", "),
    existing: true,
  }));
}

/**
 * A catalog type, created or edited: its name, its key (suggested from the
 * name, then frozen), and its attributes — free naming, with `entry`
 * attributes pointing at another type. Deleting is offered only when nothing
 * references the type; the server lists what does otherwise.
 */
export function TypeDialog({
  mode,
  types,
  type,
  isCore,
  trigger,
}: {
  mode: "create" | "edit";
  types: TypeOpt[];
  type?: TypeOpt;
  isCore?: boolean;
  trigger?: React.CSSProperties;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(type?.name ?? "");
  const [key, setKey] = useState(type?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(mode === "edit");
  const [rows, setRows] = useState<Row[]>(type ? rowsOf(type.attributes) : []);
  const [error, setError] = useState<{ error: string; details?: string[] } | null>(null);
  const [pending, start] = useTransition();
  useEscape(open, () => setOpen(false));

  const kindLabel = (k: CatalogAttributeType) => t(`catalog.attr.kind.${k}`);
  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows((rs) => [
      ...rs,
      {
        key: "",
        label: "",
        type: "text",
        refTypeKey: types[0]?.key ?? "",
        options: "",
        existing: false,
      },
    ]);

  const submit = (fd: FormData) => {
    setError(null);
    fd.set("attributes", JSON.stringify(rows));
    start(async () => {
      const res = mode === "create" ? await createType(fd) : await updateType(fd);
      if (res && "error" in res) setError(res);
      else setOpen(false);
    });
  };
  const remove = () => {
    if (!type) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("id", type.id);
      const res = await deleteType(fd);
      if (res && "error" in res) setError(res);
      else setOpen(false);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={mode === "create" ? "type-open" : "type-edit"}
        className={mode === "create" ? undefined : "oi-hover"}
        style={trigger ?? s.toolbarButton}
      >
        {mode === "create" ? t("catalog.newType") : t("catalog.typeSettings")}
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={s.overlay}>
          <form
            data-testid="type-form"
            onClick={(e) => e.stopPropagation()}
            action={submit}
            className="oi-rise"
            role="dialog"
            style={{ ...s.sheet, width: 620 }}
          >
            {type && <input type="hidden" name="id" value={type.id} />}
            <div style={s.header}>
              <div style={s.title}>
                {mode === "create"
                  ? t("catalog.newTypeTitle")
                  : t("catalog.editTypeTitle", { type: type?.label ?? "" })}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
                className="oi-hover"
                style={s.closeButton}
              >
                ✕
              </button>
            </div>
            <div style={s.body}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={s.label}>{t("catalog.field.name")}</span>
                  <input
                    name="name"
                    required
                    autoFocus
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!keyTouched) setKey(keyify(e.target.value));
                    }}
                    placeholder="Squads"
                    className="oi-field"
                    style={s.control}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={s.label}>{t("catalog.field.key")}</span>
                  <input
                    name="key"
                    required
                    value={key}
                    readOnly={mode === "edit"}
                    onChange={(e) => {
                      setKeyTouched(true);
                      setKey(e.target.value.toLowerCase());
                    }}
                    pattern="[a-z][a-z0-9_]{0,39}"
                    placeholder="squad"
                    className="oi-field"
                    style={{ ...s.control, ...s.mono, opacity: mode === "edit" ? 0.7 : 1 }}
                  />
                </label>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: -6 }}>
                {t("catalog.field.keyHint")}
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={s.label}>{t("catalog.field.description")}</span>
                <input
                  name="description"
                  defaultValue={type?.description ?? ""}
                  className="oi-field"
                  style={s.control}
                />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={s.label}>{t("catalog.typeAttributes")}</span>
                {rows.length === 0 && (
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                    {t("catalog.attrsEmpty")}
                  </div>
                )}
                {rows.map((r, i) => (
                  <div
                    key={i}
                    data-testid="attr-row"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.2fr 1fr 1fr auto",
                      gap: 8,
                      alignItems: "center",
                      padding: "8px 10px",
                      border: "1px solid var(--line)",
                      borderRadius: 10,
                      background: "var(--sunk)",
                    }}
                  >
                    <input
                      aria-label={t("catalog.attr.label")}
                      placeholder={t("catalog.attr.label")}
                      value={r.label}
                      onChange={(e) =>
                        setRow(i, {
                          label: e.target.value,
                          ...(r.existing ? {} : { key: keyify(e.target.value) }),
                        })
                      }
                      className="oi-field"
                      style={{ ...s.control, height: 32 }}
                    />
                    <input
                      aria-label={t("catalog.field.key")}
                      value={r.key}
                      readOnly={r.existing}
                      onChange={(e) => setRow(i, { key: e.target.value.toLowerCase() })}
                      className="oi-field"
                      style={{ ...s.control, ...s.mono, height: 32, opacity: r.existing ? 0.7 : 1 }}
                    />
                    <select
                      aria-label={t("catalog.attr.type")}
                      value={r.type}
                      disabled={r.existing}
                      onChange={(e) => setRow(i, { type: e.target.value as CatalogAttributeType })}
                      className="oi-field"
                      style={{ ...s.control, height: 32 }}
                    >
                      {KINDS.map((k) => (
                        <option key={k} value={k}>
                          {kindLabel(k)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                      aria-label={t("common.delete")}
                      className="oi-hover-dang"
                      style={{
                        height: 32,
                        width: 32,
                        border: "1px solid var(--line)",
                        borderRadius: 8,
                        background: "var(--panel)",
                        color: "var(--dang)",
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                    {r.type === "entry" && (
                      <label
                        style={{
                          gridColumn: "1 / -1",
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: "var(--ink-3)", flex: "none" }}>
                          {t("catalog.attr.refType")}
                        </span>
                        <select
                          value={r.refTypeKey}
                          onChange={(e) => setRow(i, { refTypeKey: e.target.value })}
                          className="oi-field"
                          style={{ ...s.control, height: 30 }}
                        >
                          {types.map((ty) => (
                            <option key={ty.id} value={ty.key}>
                              {ty.label}
                            </option>
                          ))}
                          {mode === "create" && key && !types.some((ty) => ty.key === key) && (
                            <option value={key}>{name || key}</option>
                          )}
                        </select>
                      </label>
                    )}
                    {r.type === "select" && (
                      <label
                        style={{
                          gridColumn: "1 / -1",
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: "var(--ink-3)", flex: "none" }}>
                          {t("catalog.attr.options")}
                        </span>
                        <input
                          value={r.options}
                          onChange={(e) => setRow(i, { options: e.target.value })}
                          placeholder="payments, search, platform"
                          className="oi-field"
                          style={{ ...s.control, height: 30 }}
                        />
                      </label>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addRow}
                  data-testid="attr-add"
                  className="oi-hover"
                  style={{ ...s.secondary, alignSelf: "flex-start", height: 30, fontSize: 12 }}
                >
                  {t("catalog.attr.add")}
                </button>
              </div>
              {isCore && (
                <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
                  {t("catalog.coreType")}
                </div>
              )}
              {error && (
                <p role="alert" data-testid="type-error" style={s.alert}>
                  {error.error}
                  {error.details && error.details.length > 0 && (
                    <span style={{ display: "block", marginTop: 6, ...s.mono, fontSize: 11.5 }}>
                      {error.details.join("\n")}
                    </span>
                  )}
                </p>
              )}
            </div>
            <div style={s.footer}>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {t("catalog.versionedNote")}
              </span>
              <span style={{ flex: 1 }} />
              {mode === "edit" && !isCore && (
                <button
                  type="button"
                  onClick={remove}
                  disabled={pending}
                  data-testid="type-delete"
                  className="oi-hover-dang"
                  style={s.danger}
                >
                  {t("catalog.deleteType")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="oi-hover"
                style={s.secondary}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={pending}
                data-testid="type-save"
                style={{ ...s.primary, opacity: pending ? 0.6 : 1 }}
              >
                {pending
                  ? t("common.saving")
                  : mode === "create"
                    ? t("catalog.createType")
                    : t("catalog.saveType")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
