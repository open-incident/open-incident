"use client";

import { useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import type { CatalogAttributeDef } from "@openincident/db";
import { createEntry, deleteEntry, updateEntry } from "./actions";
import * as s from "./dialog-styles";
import { useEscape } from "./use-escape";

export type TypeOpt = {
  id: string;
  key: string;
  name: string;
  label: string;
  description: string | null;
  attributes: CatalogAttributeDef[];
  locked: boolean;
};
export type EntryOpt = { id: string; typeId: string; name: string };
export type MemberOpt = { id: string; email: string; name: string };
export type EntryValue = {
  id: string;
  name: string;
  description: string | null;
  externalId: string | null;
  attributes: Record<string, unknown>;
};

type Result = { error: string; details?: string[] } | void;

/**
 * One dialog for creating and editing an entry. The fields come from the
 * type's own attribute schema — a select for a `select`, the entries of the
 * referenced type for an `entry`, emails for a `member_list` — so a custom
 * type gets the same form as the built-in ones without a line of UI.
 */
export function EntryDialog({
  mode,
  types,
  entries,
  members,
  initialTypeKey,
  entry,
  trigger,
}: {
  mode: "create" | "edit";
  types: TypeOpt[];
  entries: EntryOpt[];
  members: MemberOpt[];
  initialTypeKey: string;
  entry?: EntryValue;
  trigger?: React.CSSProperties;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [typeKey, setTypeKey] = useState(initialTypeKey);
  const [error, setError] = useState<{ error: string; details?: string[] } | null>(null);
  const [pending, start] = useTransition();
  useEscape(open, () => setOpen(false));
  const type = types.find((x) => x.key === typeKey) ?? types[0];
  if (!type) return null;
  const typeById = new Map(types.map((x) => [x.id, x]));
  const memberEmail = (id: unknown) => members.find((m) => m.id === id)?.email ?? String(id);

  const initial = (def: CatalogAttributeDef): string => {
    const raw = entry?.attributes[def.key];
    if (raw === undefined || raw === null) return "";
    if (def.type === "member_list" && Array.isArray(raw)) return raw.map(memberEmail).join("; ");
    return String(raw);
  };

  const submit = (fd: FormData) => {
    setError(null);
    start(async () => {
      const res: Result = mode === "create" ? await createEntry(fd) : await updateEntry(fd);
      if (res && "error" in res) setError(res);
      else setOpen(false);
    });
  };
  const remove = () => {
    if (!entry) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("id", entry.id);
      const res: Result = await deleteEntry(fd);
      if (res && "error" in res) setError(res);
      else setOpen(false);
    });
  };

  const field = (def: CatalogAttributeDef) => {
    const name = `attr.${def.key}`;
    const key = def.key;
    if (def.type === "select")
      return (
        <select name={name} defaultValue={initial(def)} className="oi-field" style={s.control}>
          <option value="">—</option>
          {(def.options ?? []).map((o) => (
            <option key={o} value={o}>
              {def.key === "paging"
                ? o === "pages"
                  ? t("catalog.paging.pages")
                  : t("catalog.paging.silent")
                : o}
            </option>
          ))}
        </select>
      );
    if (def.type === "entry") {
      const refType = types.find((x) => x.key === def.refTypeKey);
      const options = entries.filter((e) => e.typeId === refType?.id && e.id !== entry?.id);
      return (
        <select name={name} defaultValue={initial(def)} className="oi-field" style={s.control}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    }
    if (def.type === "member_list")
      return (
        <input
          name={name}
          defaultValue={initial(def)}
          placeholder="ana@example.com; li@example.com"
          className="oi-field"
          style={{ ...s.control, ...s.mono }}
        />
      );
    return (
      <input
        name={name}
        type={def.type === "link" ? "url" : "text"}
        defaultValue={initial(def)}
        placeholder={
          key === "repository" ? "acme/new-service" : key === "chat_channel" ? "#team-…" : undefined
        }
        className="oi-field"
        style={{
          ...s.control,
          ...(def.type === "link" || key === "repository" || key === "chat_channel" ? s.mono : {}),
        }}
      />
    );
  };

  const attrs = type.attributes;
  const hasOwner = attrs.some((a) => a.key === "owner" && a.type === "entry");
  const placeholder =
    { service: "search-index", team: "Search", environment: "preview" }[type.key] ?? "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={mode === "create" ? "entry-open" : "entry-edit"}
        style={
          trigger ?? {
            height: 34,
            padding: "0 14px",
            borderRadius: 9,
            background: "var(--brand)",
            color: "#fff",
            border: 0,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }
        }
      >
        {mode === "create" ? t("catalog.newEntry") : t("catalog.editEntry")}
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={s.overlay}>
          <form
            data-testid="entry-form"
            onClick={(e) => e.stopPropagation()}
            action={submit}
            className="oi-rise"
            role="dialog"
            style={s.sheet}
          >
            <input type="hidden" name="typeId" value={type.id} />
            {entry && <input type="hidden" name="id" value={entry.id} />}
            <div style={s.header}>
              <div style={s.title}>
                {mode === "create"
                  ? t("catalog.newEntryTitle", { type: type.label })
                  : t("catalog.editEntryTitle", { name: entry?.name ?? "" })}
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
              {mode === "create" && (
                <div role="radiogroup" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {types
                    .filter((ty) => !ty.locked)
                    .map((ty) => {
                      const on = ty.key === type.key;
                      return (
                        <button
                          key={ty.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setTypeKey(ty.key)}
                          style={{
                            height: 30,
                            padding: "0 13px",
                            border: `1px solid ${on ? "var(--brand)" : "var(--line)"}`,
                            borderRadius: 999,
                            background: on ? "var(--brand)" : "var(--panel)",
                            color: on ? "#fff" : "var(--ink-2)",
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {ty.label}
                        </button>
                      );
                    })}
                </div>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={s.label}>{t("catalog.field.name")}</span>
                <input
                  name="name"
                  required
                  autoFocus
                  defaultValue={entry?.name ?? ""}
                  placeholder={placeholder}
                  className="oi-field"
                  style={{ ...s.control, fontFamily: "var(--font-mono)" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={s.label}>{t("catalog.field.description")}</span>
                <input
                  name="description"
                  defaultValue={entry?.description ?? ""}
                  className="oi-field"
                  style={s.control}
                />
              </label>
              {attrs.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {attrs.map((def) => (
                    <label
                      key={def.key}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        gridColumn: def.type === "member_list" ? "1 / -1" : undefined,
                      }}
                    >
                      <span style={s.label}>
                        {def.label}
                        {def.type === "entry" && def.refTypeKey && (
                          <span
                            style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}
                          >
                            {" "}
                            →{" "}
                            {typeById.get(types.find((x) => x.key === def.refTypeKey)?.id ?? "")
                              ?.label ?? def.refTypeKey}
                          </span>
                        )}
                      </span>
                      {field(def)}
                    </label>
                  ))}
                </div>
              )}
              {hasOwner && (
                <div
                  style={{
                    background: "var(--brand-t)",
                    border: "1px solid var(--brand-b)",
                    borderRadius: 11,
                    padding: "11px 13px",
                    fontSize: 12,
                    color: "var(--ink-2)",
                    lineHeight: 1.5,
                  }}
                >
                  {t("catalog.ownerNote")}
                </div>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={s.label}>
                  external_id{" "}
                  <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
                    · {t("catalog.field.externalIdHint")}
                  </span>
                </span>
                <input
                  name="externalId"
                  defaultValue={entry?.externalId ?? ""}
                  placeholder="svc_new_01"
                  className="oi-field"
                  style={{ ...s.control, ...s.mono }}
                />
              </label>
              {error && (
                <p role="alert" data-testid="entry-error" style={s.alert}>
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
              {mode === "edit" && (
                <button
                  type="button"
                  onClick={remove}
                  disabled={pending}
                  data-testid="entry-delete"
                  className="oi-hover-dang"
                  style={s.danger}
                >
                  {t("catalog.deleteEntry")}
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
                data-testid="entry-save"
                style={{ ...s.primary, opacity: pending ? 0.6 : 1 }}
              >
                {pending
                  ? t("common.saving")
                  : mode === "create"
                    ? t("catalog.createEntry")
                    : t("catalog.saveEntry")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
