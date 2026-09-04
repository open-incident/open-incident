"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { createComponent, createMaintenance, createStatusPage } from "./actions";

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
const control: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  border: "1px solid var(--line)",
  borderRadius: 10,
  outline: "none",
  fontSize: 13,
  background: "var(--panel)",
  width: "100%",
};

function Frame({
  title,
  testId,
  action,
  onClose,
  submit,
  children,
}: {
  title: string;
  testId: string;
  action: (fd: FormData) => void | Promise<void>;
  onClose: () => void;
  submit: string;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div
      onClick={onClose}
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
        data-testid={testId}
        action={action}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        className="oi-rise"
        style={{
          width: 540,
          maxWidth: "100%",
          background: "var(--panel)",
          borderRadius: 18,
          boxShadow: "var(--shadow-modal)",
        }}
      >
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
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="oi-hover"
            style={{
              marginLeft: "auto",
              width: 30,
              height: 30,
              borderRadius: 8,
              border: 0,
              background: "transparent",
              color: "var(--ink-3)",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 13 }}>
          {children}
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
          <button
            type="button"
            onClick={onClose}
            className="oi-hover"
            style={{
              height: 34,
              padding: "0 13px",
              border: "1px solid var(--line)",
              borderRadius: 9,
              background: "var(--panel)",
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            {t("common.cancel")}
          </button>
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
              whiteSpace: "nowrap",
            }}
          >
            {submit}
          </button>
        </div>
      </form>
    </div>
  );
}

export function NewPageDialog({ defaultAccent }: { defaultAccent: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return (
    <>
      <button
        type="button"
        data-testid="page-new"
        onClick={() => setOpen(true)}
        className="oi-hover"
        style={{
          marginTop: 4,
          padding: "8px 10px",
          border: "1.5px dashed var(--line)",
          borderRadius: 9,
          fontSize: 12.5,
          color: "var(--ink-3)",
          background: "transparent",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        {t("statusPages.newPage")}
      </button>
      {open && (
        <Frame
          title={t("statusPages.newPageTitle")}
          testId="page-form"
          action={createStatusPage}
          onClose={() => setOpen(false)}
          submit={t("common.create")}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>{t("oncall.name")}</span>
            <input
              name="name"
              required
              autoFocus
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Skylark Status"
              className="oi-field"
              style={control}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("statusPages.slug")}</span>
              <input
                name="slug"
                required
                defaultValue={slug}
                key={slug}
                pattern="[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?"
                className="oi-field"
                style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12.5 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("statusPages.language")}</span>
              <select name="locale" defaultValue="en" className="oi-field" style={control}>
                <option value="en">{t("statusPages.locale.en")}</option>
                <option value="fr">{t("statusPages.locale.fr")}</option>
                <option value="de">{t("statusPages.locale.de")}</option>
              </select>
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>{t("statusPages.accent")}</span>
            <input
              name="accentColor"
              defaultValue={defaultAccent}
              pattern="#[0-9a-fA-F]{6}"
              className="oi-field"
              style={{ ...control, fontFamily: "var(--font-mono)", fontSize: 12.5, width: 140 }}
            />
          </label>
          <div
            style={{
              background: "var(--sunk)",
              borderRadius: 11,
              padding: "11px 13px",
              fontSize: 12,
              color: "var(--ink-2)",
              lineHeight: 1.5,
            }}
          >
            {t("statusPages.newPageNote")}
          </div>
        </Frame>
      )}
    </>
  );
}

export function NewComponentDialog({
  pageId,
  services,
}: {
  pageId: string;
  services: Array<{ id: string; name: string }>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="component-new"
        onClick={() => setOpen(true)}
        className="oi-hover"
        style={{
          height: 30,
          padding: "0 12px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--panel)",
          fontSize: 12.5,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        {t("statusPages.newComponent")}
      </button>
      {open && (
        <Frame
          title={t("statusPages.newComponentTitle")}
          testId="component-form"
          action={createComponent}
          onClose={() => setOpen(false)}
          submit={t("common.create")}
        >
          <input type="hidden" name="pageId" value={pageId} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("oncall.name")}</span>
              <input
                name="name"
                required
                autoFocus
                maxLength={60}
                placeholder="Checkout"
                className="oi-field"
                style={control}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("statusPages.group")}</span>
              <input
                name="groupName"
                maxLength={60}
                placeholder={t("common.optional")}
                className="oi-field"
                style={control}
              />
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>{t("statusPages.serviceLink")}</span>
            <select name="serviceEntryId" defaultValue="" className="oi-field" style={control}>
              <option value="">—</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div
            style={{
              background: "var(--sunk)",
              borderRadius: 11,
              padding: "11px 13px",
              fontSize: 12,
              color: "var(--ink-2)",
              lineHeight: 1.5,
            }}
          >
            {t("statusPages.componentNote")}
          </div>
        </Frame>
      )}
    </>
  );
}

export function MaintenanceDialog({
  pageId,
  components,
}: {
  pageId: string;
  components: Array<{ id: string; name: string }>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const iso = (v: string) => (v ? new Date(v).toISOString() : "");
  return (
    <>
      <button
        type="button"
        data-testid="maintenance-open"
        onClick={() => setOpen(true)}
        className="oi-hover"
        style={{
          height: 34,
          padding: "0 13px",
          border: "1px solid var(--line)",
          borderRadius: 9,
          background: "var(--panel)",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        {t("statusPages.scheduleMaintenance")}
      </button>
      {open && (
        <Frame
          title={t("statusPages.scheduleMaintenance")}
          testId="maintenance-form"
          action={createMaintenance}
          onClose={() => setOpen(false)}
          submit={t("statusPages.schedule")}
        >
          <input type="hidden" name="pageId" value={pageId} />
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>{t("statusPages.maintenanceTitle")}</span>
            <input
              name="title"
              required
              autoFocus
              maxLength={140}
              placeholder={t("statusPages.maintenancePlaceholder")}
              className="oi-field"
              style={control}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>{t("statusPages.message")}</span>
            <textarea
              name="body"
              rows={3}
              maxLength={2000}
              className="oi-field"
              style={{ ...control, height: "auto", padding: "10px 12px", resize: "vertical" }}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("oncall.from")}</span>
              <input
                type="datetime-local"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="oi-field"
                style={control}
              />
              <input type="hidden" name="startAt" value={iso(start)} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("oncall.to")}</span>
              <input
                type="datetime-local"
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="oi-field"
                style={control}
              />
              <input type="hidden" name="endAt" value={iso(end)} />
            </label>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>{t("statusPages.components")}</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {components.map((c) => (
                <label
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    border: "1px solid var(--line)",
                    borderRadius: 999,
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  <input type="checkbox" name="componentIds" value={c.id} /> {c.name}
                </label>
              ))}
            </div>
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
            <input type="checkbox" name="autoTransitions" value="on" defaultChecked />{" "}
            {t("statusPages.autoTransitionsLabel")}
            <input type="hidden" name="autoTransitions" value="off" />
          </label>
          <div
            style={{
              background: "var(--sunk)",
              borderRadius: 11,
              padding: "11px 13px",
              fontSize: 12,
              color: "var(--ink-2)",
              lineHeight: 1.5,
            }}
          >
            {t("statusPages.maintenanceNote")}
          </div>
        </Frame>
      )}
    </>
  );
}
