"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { importCsv, type ImportOutcome } from "./actions";
import * as s from "./dialog-styles";
import { useEscape } from "./use-escape";
import type { TypeOpt } from "./entry-dialog";

/**
 * CSV import for one type. The expected header is shown from the type's own
 * schema; the result is the server's report — counts, or the full list of
 * refused rows when nothing was written.
 */
export function ImportDialog({ type }: { type: TypeOpt }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [pending, start] = useTransition();
  useEscape(open, () => setOpen(false));
  const columns = ["name", "description", "external_id", ...type.attributes.map((a) => a.key)];

  const submit = (fd: FormData) => {
    setOutcome(null);
    start(async () => {
      const res = await importCsv(fd);
      setOutcome(res);
      if (!("error" in res)) router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOutcome(null);
          setOpen(true);
        }}
        data-testid="import-open"
        className="oi-hover"
        style={s.toolbarButton}
      >
        {t("catalog.import")}
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={s.overlay}>
          <form
            data-testid="import-form"
            onClick={(e) => e.stopPropagation()}
            action={submit}
            className="oi-rise"
            role="dialog"
            style={s.sheet}
          >
            <input type="hidden" name="typeId" value={type.id} />
            <div style={s.header}>
              <div style={s.title}>{t("catalog.importTitle", { type: type.label })}</div>
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
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                {t("catalog.importHint")}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={s.label}>{t("catalog.importColumns")}</span>
                <code
                  data-testid="import-columns"
                  style={{
                    ...s.mono,
                    padding: "9px 12px",
                    background: "var(--sunk)",
                    borderRadius: 10,
                    overflowX: "auto",
                    whiteSpace: "nowrap",
                  }}
                >
                  {columns.join(",")}
                </code>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={s.label}>{t("catalog.importFile")}</span>
                <input
                  name="file"
                  type="file"
                  accept=".csv,text/csv"
                  required
                  data-testid="import-file"
                  style={{ fontSize: 13 }}
                />
              </label>
              {outcome && "error" in outcome && (
                <p role="alert" data-testid="import-error" style={s.alert}>
                  {outcome.error}
                  {outcome.details && outcome.details.length > 0 && (
                    <span style={{ display: "block", marginTop: 6, ...s.mono, fontSize: 11.5 }}>
                      {outcome.details.join("\n")}
                    </span>
                  )}
                </p>
              )}
              {outcome && !("error" in outcome) && (
                <p
                  role="status"
                  data-testid="import-result"
                  style={{
                    margin: 0,
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "var(--ok-t, var(--brand-t))",
                    border: "1px solid var(--brand-b)",
                    color: "var(--ink)",
                    fontSize: 13,
                  }}
                >
                  {t("catalog.importResult", {
                    created: outcome.created,
                    updated: outcome.updated,
                    unchanged: outcome.unchanged,
                  })}
                </p>
              )}
            </div>
            <div style={s.footer}>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {t("catalog.versionedNote")}
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="oi-hover"
                style={s.secondary}
              >
                {t("common.close")}
              </button>
              <button
                type="submit"
                disabled={pending}
                data-testid="import-run"
                style={{ ...s.primary, opacity: pending ? 0.6 : 1 }}
              >
                {pending ? t("common.saving") : t("catalog.importRun")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
