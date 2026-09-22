"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import {
  createComponent,
  createMaintenance,
  createStatusPage,
  editMaintenance,
  updateComponent,
} from "./actions";

/** A monitor as the "add a component" choice needs it: a name and how it is. */
export type MonitorChoice = {
  id: string;
  name: string;
  type: string;
  state: "online" | "degraded" | "offline" | "paused" | "waiting";
};

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
const control: React.CSSProperties = {
  height: 38,
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "0 12px",
  fontSize: 14,
  outline: "none",
  background: "var(--panel)",
  width: "100%",
};
const select: React.CSSProperties = { ...control, padding: "0 9px", fontSize: 13.5 };
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5 };
const note: React.CSSProperties = {
  background: "var(--sunk)",
  borderRadius: 11,
  padding: "11px 13px",
  fontSize: 12,
  color: "var(--ink-2)",
  lineHeight: 1.5,
};

/** The design's modal: 520 px, header, body, a sunk footer with the two buttons. */
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
        background: "var(--scrim)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        zIndex: 50,
      }}
    >
      <form
        data-testid={testId}
        action={action}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        className="oi-rise"
        style={{
          width: 520,
          maxWidth: "calc(100vw - 32px)",
          background: "var(--panel)",
          borderRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 22px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span style={{ fontFamily: "var(--title)", fontSize: 17, fontWeight: 600 }}>{title}</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="oi-hover"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: 0,
              display: "grid",
              placeItems: "center",
              background: "transparent",
              color: "var(--ink-3)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 13 }}>
          {children}
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "14px 22px",
            borderTop: "1px solid var(--line)",
            background: "var(--sunk)",
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
            className="oi-hover-brand-2"
            style={{
              height: 34,
              padding: "0 16px",
              borderRadius: 9,
              border: 0,
              background: "var(--brand)",
              color: "var(--on-brand)",
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
        className="oi-hover-brand-2"
        style={{
          height: 32,
          padding: "0 13px",
          borderRadius: 9,
          border: 0,
          background: "var(--brand)",
          color: "var(--on-brand)",
          display: "flex",
          alignItems: "center",
          fontSize: 12.5,
          fontWeight: 600,
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
          <label style={field}>
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
            <label style={field}>
              <span style={label}>{t("statusPages.slug")}</span>
              <input
                name="slug"
                required
                defaultValue={slug}
                key={slug}
                pattern="[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?"
                className="oi-field"
                style={{ ...control, fontFamily: "var(--mono)", fontSize: 12.5 }}
              />
            </label>
            <label style={field}>
              <span style={label}>{t("statusPages.language")}</span>
              <select name="locale" defaultValue="en" className="oi-field" style={select}>
                <option value="en">{t("statusPages.locale.en")}</option>
                <option value="fr">{t("statusPages.locale.fr")}</option>
                <option value="de">{t("statusPages.locale.de")}</option>
              </select>
            </label>
          </div>
          <label style={field}>
            <span style={label}>{t("statusPages.accent")}</span>
            <input
              name="accentColor"
              defaultValue={defaultAccent}
              pattern="#[0-9a-fA-F]{6}"
              className="oi-field"
              style={{ ...control, fontFamily: "var(--mono)", fontSize: 12.5, width: 140 }}
            />
          </label>
          <div style={note}>{t("statusPages.newPageNote")}</div>
        </Frame>
      )}
    </>
  );
}

/**
 * Add a component. The one real choice is where its status comes from: a
 * monitor, and then the component never has to be touched again, or a human,
 * from the incidents. Without a single monitor the first choice is not offered
 * — an empty select is a dead control.
 */
export function NewComponentDialog({
  pageId,
  services,
  monitors,
}: {
  pageId: string;
  services: Array<{ id: string; name: string }>;
  monitors: MonitorChoice[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"monitor" | "manual">(
    monitors.length > 0 ? "monitor" : "manual",
  );
  const chip = (on: boolean): React.CSSProperties => ({
    flex: 1,
    border: on ? "1.5px solid var(--brand)" : "1px solid var(--line)",
    background: on ? "var(--brand-t)" : "var(--panel)",
    borderRadius: 11,
    padding: "11px 13px",
    textAlign: "left",
    cursor: "pointer",
    color: "inherit",
    font: "inherit",
  });
  return (
    <>
      <button
        type="button"
        data-testid="component-new"
        onClick={() => setOpen(true)}
        className="oi-hover"
        style={{
          height: 28,
          padding: "0 11px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--panel)",
          display: "flex",
          alignItems: "center",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("statusPages.newComponent")}
      </button>
      {open && (
        <Frame
          title={t("sp2.addComponentTitle")}
          testId="component-form"
          action={createComponent}
          onClose={() => setOpen(false)}
          submit={t("sp2.addComponent")}
        >
          <input type="hidden" name="pageId" value={pageId} />
          <input type="hidden" name="source" value={mode} />
          <label style={field}>
            <span style={label}>{t("sp2.publicName")}</span>
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
          <label style={field}>
            <span style={label}>
              {t("sp2.descriptionLabel")} · {t("common.optional")}
            </span>
            <input
              name="description"
              maxLength={120}
              placeholder={t("sp2.descriptionHint")}
              className="oi-field"
              style={control}
            />
          </label>
          <label style={field}>
            <span style={label}>
              {t("statusPages.group")} · {t("common.optional")}
            </span>
            <input name="groupName" maxLength={60} className="oi-field" style={control} />
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>{t("sp2.sourceLabel")}</span>
            <div style={{ display: "flex", gap: 6 }}>
              {monitors.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMode("monitor")}
                  aria-pressed={mode === "monitor"}
                  style={chip(mode === "monitor")}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t("sp2.sourceMonitor")}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                    {t("sp2.sourceMonitorHint")}
                  </div>
                </button>
              )}
              <button
                type="button"
                onClick={() => setMode("manual")}
                aria-pressed={mode === "manual"}
                style={chip(mode === "manual")}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t("sp2.sourceManual")}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                  {t("sp2.sourceManualHint")}
                </div>
              </button>
            </div>
          </div>
          {mode === "monitor" ? (
            <>
              <label style={field}>
                <span style={label}>{t("sp2.monitorLabel")}</span>
                <select name="monitorId" className="oi-field" style={select}>
                  {monitors.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {m.type} — {t(`monitors.state.${m.state}`)}
                    </option>
                  ))}
                </select>
              </label>
              <div style={note}>{t("sp2.trackedNote")}</div>
            </>
          ) : (
            <>
              <label style={field}>
                <span style={label}>{t("statusPages.serviceLink")}</span>
                <select
                  name="serviceId"
                  defaultValue=""
                  className="oi-field"
                  style={select}
                  disabled={services.length === 0}
                >
                  <option value="">—</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <div style={note}>
                {monitors.length === 0
                  ? `${t("sp2.noMonitors")} ${t("statusPages.componentNote")}`
                  : t("statusPages.componentNote")}
              </div>
            </>
          )}
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
          height: 28,
          padding: "0 11px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--panel)",
          display: "flex",
          alignItems: "center",
          fontSize: 12,
          fontWeight: 600,
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
          <label style={field}>
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
          <label style={field}>
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
            <label style={field}>
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
            <label style={field}>
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
            {/* The hidden "off" comes first: a checked box appends "on" after
                it, and Object.fromEntries keeps the last value. */}
            <input type="hidden" name="autoTransitions" value="off" />
            <input type="checkbox" name="autoTransitions" value="on" defaultChecked />{" "}
            {t("statusPages.autoTransitionsLabel")}
          </label>
          <div style={note}>{t("statusPages.maintenanceNote")}</div>
        </Frame>
      )}
    </>
  );
}

/**
 * Rename a component, or write the line the public page shows under its name.
 * Nothing else: what a component *is* — the monitor behind it — is not
 * something to change after the fact, it is a different component.
 */
export function EditComponentDialog({
  id,
  name,
  description,
}: {
  id: string;
  name: string;
  description: string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="component-edit"
        onClick={() => setOpen(true)}
        aria-label={t("common.edit")}
        title={t("common.edit")}
        className="oi-hover"
        style={{
          width: 26,
          height: 26,
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--panel)",
          display: "grid",
          placeItems: "center",
          fontSize: 11,
          cursor: "pointer",
          color: "inherit",
          flex: "none",
        }}
      >
        ✎
      </button>
      {open && (
        <Frame
          title={t("sp2.editComponentTitle")}
          testId="component-edit-form"
          action={updateComponent}
          onClose={() => setOpen(false)}
          submit={t("common.save")}
        >
          <input type="hidden" name="id" value={id} />
          <label style={field}>
            <span style={label}>{t("sp2.publicName")}</span>
            <input
              name="name"
              required
              autoFocus
              maxLength={60}
              defaultValue={name}
              className="oi-field"
              style={control}
            />
          </label>
          <label style={field}>
            <span style={label}>
              {t("sp2.descriptionLabel")} · {t("common.optional")}
            </span>
            <input
              name="description"
              maxLength={120}
              defaultValue={description ?? ""}
              placeholder={t("sp2.descriptionHint")}
              className="oi-field"
              style={control}
            />
          </label>
        </Frame>
      )}
    </>
  );
}

/**
 * Moving a maintenance window that has not started yet.
 *
 * The same fields as scheduling one, filled in — and the same client-side
 * conversion, because a `datetime-local` value carries no zone and the only
 * machine that knows which zone the reader meant is the one they typed it on.
 * The server would guess its own, which in production is UTC.
 */
export function MaintenanceEditDialog({
  id,
  pageId,
  title,
  body,
  startAt,
  endAt,
  componentIds,
  components,
}: {
  id: string;
  pageId: string;
  title: string;
  body: string;
  /** ISO, because a Date cannot cross into a client component. */
  startAt: string;
  endAt: string;
  componentIds: string[];
  components: Array<{ id: string; name: string }>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(() => local(startAt));
  const [end, setEnd] = useState(() => local(endAt));
  const iso = (v: string) => (v ? new Date(v).toISOString() : "");
  return (
    <>
      <button
        type="button"
        data-testid="maintenance-edit"
        onClick={() => setOpen(true)}
        aria-label={t("common.edit")}
        title={t("common.edit")}
        className="oi-hover"
        style={{
          width: 26,
          height: 26,
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--panel)",
          display: "grid",
          placeItems: "center",
          fontSize: 11,
          cursor: "pointer",
          color: "inherit",
          flex: "none",
        }}
      >
        ✎
      </button>
      {open && (
        <Frame
          title={t("sp2.editMaintenanceTitle")}
          testId="maintenance-edit-form"
          action={editMaintenance}
          onClose={() => setOpen(false)}
          submit={t("common.save")}
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="pageId" value={pageId} />
          <label style={field}>
            <span style={label}>{t("statusPages.maintenanceTitle")}</span>
            <input
              name="title"
              required
              autoFocus
              maxLength={140}
              defaultValue={title}
              className="oi-field"
              style={control}
            />
          </label>
          <label style={field}>
            <span style={label}>{t("statusPages.message")}</span>
            <textarea
              name="body"
              rows={3}
              maxLength={2000}
              defaultValue={body}
              className="oi-field"
              style={{ ...control, height: "auto", padding: "10px 12px", resize: "vertical" }}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={field}>
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
            <label style={field}>
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
                  <input
                    type="checkbox"
                    name="componentIds"
                    value={c.id}
                    defaultChecked={componentIds.includes(c.id)}
                  />{" "}
                  {c.name}
                </label>
              ))}
            </div>
          </div>
          <div style={note}>{t("sp2.editMaintenanceNote")}</div>
        </Frame>
      )}
    </>
  );
}

/** ISO → what a `datetime-local` input wants, in the reader's own zone. */
function local(iso: string): string {
  const at = new Date(iso);
  const shifted = new Date(at.getTime() - at.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}
