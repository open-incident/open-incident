"use client";

/**
 * The two buttons beside the service's name — "Merge with…" and "Add runbook"
 * — and, for the one case it applies to, "Remove".
 *
 * Merging is how two names of one thing become one service: `storefront` in
 * the traces and `web-storefront` in the alerts. The reader chooses which
 * name stays; the other keeps being recognised and counts for it.
 */

import { useState } from "react";
import { useT } from "@/i18n/client";
import { createRunbook, deleteService, mergeServices } from "../actions";
import { BTN_BRAND, BTN_GHOST, CONTROL, Dialog, FIELD_LABEL } from "../dialog";

const BTN: React.CSSProperties = {
  height: 34,
  padding: "0 13px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  display: "flex",
  alignItems: "center",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  color: "inherit",
};

export function HeaderActions({
  service,
  others,
  mayManage,
  deletable,
}: {
  service: { id: string; key: string };
  others: Array<{ id: string; key: string; confirmed: boolean }>;
  mayManage: boolean;
  deletable: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState<"merge" | "runbook" | null>(null);
  if (!mayManage) return null;
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {deletable && (
        <form action={deleteService}>
          <input type="hidden" name="serviceId" value={service.id} />
          <button
            type="submit"
            data-testid="service-delete"
            className="oi-hover-dang"
            title={t("services.deleteHint")}
            style={{ ...BTN, color: "var(--dang)" }}
          >
            {t("services.delete")}
          </button>
        </form>
      )}
      {others.length > 0 && (
        <button
          type="button"
          data-testid="service-merge"
          className="oi-hover"
          onClick={() => setOpen("merge")}
          style={BTN}
        >
          {t("services.mergeWith")}
        </button>
      )}
      <button
        type="button"
        data-testid="runbook-open"
        className="oi-hover"
        onClick={() => setOpen("runbook")}
        style={BTN}
      >
        {t("services.addRunbook")}
      </button>
      {open === "merge" && (
        <MergeDialog service={service} others={others} onClose={() => setOpen(null)} />
      )}
      {open === "runbook" && <RunbookDialog serviceId={service.id} onClose={() => setOpen(null)} />}
    </div>
  );
}

function MergeDialog({
  service,
  others,
  onClose,
}: {
  service: { id: string; key: string };
  others: Array<{ id: string; key: string; confirmed: boolean }>;
  onClose: () => void;
}) {
  const t = useT();
  const [otherId, setOtherId] = useState(others[0]!.id);
  const [keepThis, setKeepThis] = useState(true);
  const other = others.find((o) => o.id === otherId) ?? others[0]!;
  const keep = keepThis ? service : other;
  const fold = keepThis ? other : service;
  return (
    <Dialog
      title={t("services.mergeTitle", { service: service.key })}
      onClose={onClose}
      testId="merge-dialog"
      footer={
        <form action={mergeServices} style={{ display: "flex", gap: 8 }}>
          <input type="hidden" name="keepId" value={keep.id} />
          <input type="hidden" name="foldId" value={fold.id} />
          <button type="button" onClick={onClose} className="oi-hover" style={BTN_GHOST}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            data-testid="merge-submit"
            className="oi-hover-brand-2"
            style={BTN_BRAND}
          >
            {t("services.mergeSubmit")}
          </button>
        </form>
      }
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={FIELD_LABEL}>{t("services.mergeOther")}</span>
        <select
          data-testid="merge-other"
          value={otherId}
          onChange={(e) => setOtherId(e.target.value)}
          style={{ ...CONTROL, fontFamily: "var(--mono)", fontSize: 13, padding: "0 9px" }}
        >
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.key}
              {o.confirmed ? "" : ` — ${t("services.seenOnly")}`}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={FIELD_LABEL}>{t("services.mergeKeep")}</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { on: keepThis, key: service.key, pick: () => setKeepThis(true) },
            { on: !keepThis, key: other.key, pick: () => setKeepThis(false) },
          ].map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={o.pick}
              aria-pressed={o.on}
              style={{
                height: 32,
                padding: "0 12px",
                border: o.on ? "1.5px solid var(--brand)" : "1px solid var(--line)",
                borderRadius: 9,
                background: o.on ? "var(--brand-t)" : "var(--panel)",
                color: o.on ? "var(--brand)" : "var(--ink-2)",
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {o.key}
            </button>
          ))}
        </div>
      </div>
      <div
        style={{
          background: "var(--sunk)",
          borderRadius: 11,
          padding: "11px 13px",
          fontSize: 12.5,
          color: "var(--ink-2)",
          lineHeight: 1.55,
        }}
      >
        {t("services.mergeExplain", { fold: fold.key, keep: keep.key })}
      </div>
    </Dialog>
  );
}

function RunbookDialog({ serviceId, onClose }: { serviceId: string; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog title={t("services.addRunbook")} onClose={onClose} testId="runbook-dialog">
      <form
        action={createRunbook}
        data-testid="runbook-form"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <input type="hidden" name="serviceId" value={serviceId} />
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={FIELD_LABEL}>{t("svc.runbooks.name")}</span>
          <input name="title" required minLength={2} maxLength={160} autoFocus style={CONTROL} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={FIELD_LABEL}>{t("services.runbookUrl")}</span>
          <input
            name="sourceUrl"
            type="url"
            placeholder={t("svc.runbooks.url")}
            style={{ ...CONTROL, fontFamily: "var(--mono)", fontSize: 12.5 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={FIELD_LABEL}>{t("services.runbookText")}</span>
          <textarea
            name="content"
            rows={5}
            placeholder={t("svc.runbooks.content")}
            style={{ ...CONTROL, height: "auto", padding: "9px 12px", resize: "vertical" }}
          />
        </label>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
          {t("svc.runbooks.hint")}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} className="oi-hover" style={BTN_GHOST}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            data-testid="runbook-save"
            className="oi-hover-brand-2"
            style={BTN_BRAND}
          >
            {t("svc.runbooks.add")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
