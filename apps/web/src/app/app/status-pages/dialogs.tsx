"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/i18n/client";
import {
  cancelMaintenance,
  correctIncidentUpdate,
  createComponent,
  createMaintenance,
  createStatusPage,
  deleteComponent,
  editMaintenance,
  saveComponent,
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
  footerStart,
  children,
}: {
  title: string;
  testId: string;
  /** Without one, the frame is a panel of its own forms, not a form. */
  action?: (fd: FormData) => void | Promise<void>;
  onClose: () => void;
  /** The primary button's label; none, and the footer only closes. */
  submit?: string;
  /** Left of the footer: a destructive gesture, kept apart from Save. */
  footerStart?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT();
  const body = (
    <>
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
          alignItems: "center",
          gap: 8,
          padding: "14px 22px",
          borderTop: "1px solid var(--line)",
          background: "var(--sunk)",
        }}
      >
        {footerStart}
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
          {submit ? t("common.cancel") : t("common.close")}
        </button>
        {submit && (
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
        )}
      </div>
    </>
  );
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
      {action ? (
        <form
          data-testid={testId}
          action={action}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          style={{
            animation: "oi-rise .16s ease backwards",
            width: 520,
            maxWidth: "calc(100vw - 32px)",
            background: "var(--panel)",
            borderRadius: "var(--radius-modal)",
            boxShadow: "var(--shadow-modal)",
            overflow: "hidden",
          }}
        >
          {body}
        </form>
      ) : (
        <div
          data-testid={testId}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          style={{
            animation: "oi-rise .16s ease backwards",
            width: 520,
            maxWidth: "calc(100vw - 32px)",
            background: "var(--panel)",
            borderRadius: "var(--radius-modal)",
            boxShadow: "var(--shadow-modal)",
            overflow: "hidden",
          }}
        >
          {body}
        </div>
      )}
    </div>
  );
}

/**
 * A row that opens its dialog: the whole line is the control, the way the
 * design draws these rows — no pencil, no cross, nothing but the row.
 */
function RowTrigger({
  testId,
  label,
  onOpen,
  style,
  children,
}: {
  testId: string;
  label: string;
  onOpen: () => void;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      data-testid={testId}
      className="oi-hover"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{ cursor: "pointer", ...style }}
    >
      {children}
    </div>
  );
}

const ghostDanger: React.CSSProperties = {
  height: 34,
  padding: "0 13px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  color: "var(--dang)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};

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
 * — an empty select is a dead control. A manual component may name the
 * service behind it: that is how an incident on the service finds it.
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
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>{t("sp2.sourceLabel")}</span>
            <div style={{ display: "flex", gap: 6 }}>
              {monitors.length > 0 && (
                <button
                  type="button"
                  data-testid="component-source-monitor"
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
                data-testid="component-source-manual"
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
            <label style={field}>
              <span style={label}>{t("sp2.monitorLabel")}</span>
              <select name="monitorId" className="oi-field" style={select}>
                {monitors.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {t(`monitors.state.${m.state}`).toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            services.length > 0 && (
              <label style={field}>
                <span style={label}>
                  {t("statusPages.serviceLink")} · {t("common.optional")}
                </span>
                <select name="serviceId" defaultValue="" className="oi-field" style={select}>
                  <option value="">—</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )
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
 * One component, opened from its row: its public name, the line under it and
 * its group for a manager; its state for anybody who responds, when a person
 * sets it. A tracked component says what its monitor says — the dialog shows
 * it and offers nothing to change it. Deleting sits apart, on the left.
 */
export function ComponentDialog({
  id,
  name,
  description,
  groupName,
  state,
  tracked,
  manages,
  children,
  rowStyle,
}: {
  id: string;
  name: string;
  description: string | null;
  groupName: string | null;
  state: string;
  tracked: boolean;
  manages: boolean;
  children: React.ReactNode;
  rowStyle: React.CSSProperties;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <RowTrigger
        testId="component-row"
        label={`${t("sp2.editComponentTitle")} — ${name}`}
        onOpen={() => setOpen(true)}
        style={rowStyle}
      >
        {children}
      </RowTrigger>
      {open && (
        <Frame
          title={t("sp2.editComponentTitle")}
          testId="component-edit-form"
          action={saveComponent}
          onClose={() => setOpen(false)}
          submit={t("common.save")}
          footerStart={
            manages ? (
              <button
                type="submit"
                formAction={deleteComponent}
                formNoValidate
                data-testid="component-delete"
                className="oi-hover-dang"
                style={ghostDanger}
              >
                {t("common.delete")}
              </button>
            ) : undefined
          }
        >
          <input type="hidden" name="id" value={id} />
          {manages ? (
            <>
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
              <label style={field}>
                <span style={label}>
                  {t("statusPages.group")} · {t("common.optional")}
                </span>
                <input
                  name="groupName"
                  maxLength={60}
                  defaultValue={groupName ?? ""}
                  className="oi-field"
                  style={control}
                />
              </label>
            </>
          ) : (
            <div style={{ fontSize: 15, fontWeight: 600 }}>{name}</div>
          )}
          {tracked ? (
            <div style={note}>{t("sp2.trackedNote")}</div>
          ) : (
            <label style={field}>
              <span style={label}>{t("sp2.stateLabel")}</span>
              <select
                name="state"
                defaultValue={state}
                data-testid="component-state"
                className="oi-field"
                style={select}
              >
                {(
                  [
                    "operational",
                    "degraded",
                    "partial_outage",
                    "major_outage",
                    "maintenance",
                  ] as const
                ).map((s) => (
                  <option key={s} value={s}>
                    {t(`statusPages.state.${s}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </Frame>
      )}
    </>
  );
}

/** One published update as the correction form needs it. */
export type PublicUpdate = {
  id: string;
  status: "investigating" | "identified" | "monitoring" | "resolved";
  body: string;
  at: string;
  notified: number;
  correctedAt: string | null;
};

/**
 * A public incident, opened from its row: the words the page shows, update by
 * update, each one correctable where it was published from. Correcting does
 * not notify anybody again; the page says the text was corrected.
 */
export function PublicIncidentDialog({
  pageId,
  title,
  incidentNumber,
  updates,
  acts,
  children,
  rowStyle,
}: {
  pageId: string;
  title: string;
  incidentNumber: number | null;
  updates: PublicUpdate[];
  acts: boolean;
  children: React.ReactNode;
  rowStyle: React.CSSProperties;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const when = (iso: string) => t.fmt.dateTime(new Date(iso), t.timeZone);
  return (
    <>
      <RowTrigger
        testId="public-incident"
        label={title}
        onOpen={() => setOpen(true)}
        style={rowStyle}
      >
        {children}
      </RowTrigger>
      {open && (
        <Frame
          title={title}
          testId="public-updates"
          onClose={() => setOpen(false)}
          footerStart={
            incidentNumber !== null ? (
              <Link
                href={`/app/incidents/${incidentNumber}`}
                className="oi-link"
                style={{ fontSize: 12.5, fontWeight: 600 }}
              >
                {t("alst.sp.openIncident", { number: String(incidentNumber) })}
              </Link>
            ) : undefined
          }
        >
          {updates.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("alst.sp.noUpdates")}</div>
          )}
          {updates.map((u, k) => (
            <form
              key={u.id}
              action={correctIncidentUpdate}
              data-testid="update-form"
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              <input type="hidden" name="id" value={u.id} />
              <input type="hidden" name="pageId" value={pageId} />
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                  flexWrap: "wrap",
                }}
              >
                <strong style={{ color: "var(--ink-2)" }}>
                  {t(`statusPages.publicStatus.${u.status}`)}
                </strong>
                <span>{when(u.at)}</span>
                {u.notified > 0 && <span>{t("statusPages.notifiedCount", { n: u.notified })}</span>}
                {u.correctedAt && (
                  <span style={{ color: "var(--wait)" }}>
                    {t("statusPages.correctedAt", { when: when(u.correctedAt) })}
                  </span>
                )}
              </div>
              <textarea
                name="body"
                defaultValue={u.body}
                rows={2}
                readOnly={!acts}
                className="oi-field"
                style={{
                  ...control,
                  height: "auto",
                  padding: "8px 10px",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                }}
              />
              {acts && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Only the newest update owns the status the page is
                      showing; an older one's is what the page said then. */}
                  {k === 0 && (
                    <select
                      name="status"
                      defaultValue={u.status}
                      className="oi-field"
                      style={{ ...select, height: 30, fontSize: 12, width: "auto" }}
                    >
                      {(["investigating", "identified", "monitoring", "resolved"] as const).map(
                        (x) => (
                          <option key={x} value={x}>
                            {t(`statusPages.publicStatus.${x}`)}
                          </option>
                        ),
                      )}
                    </select>
                  )}
                  <button
                    type="submit"
                    data-testid="correct-update"
                    className="oi-hover"
                    style={{
                      height: 30,
                      padding: "0 11px",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      background: "var(--panel)",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {t("statusPages.correct")}
                  </button>
                  <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                    {t("statusPages.correctNote")}
                  </span>
                </div>
              )}
            </form>
          ))}
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
  editable,
  cancellable,
  children,
  rowStyle,
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
  /** Not started yet: it can still move. */
  editable: boolean;
  /** Scheduled or under way: it can still be called off. */
  cancellable: boolean;
  children: React.ReactNode;
  rowStyle: React.CSSProperties;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(() => local(startAt));
  const [end, setEnd] = useState(() => local(endAt));
  const iso = (v: string) => (v ? new Date(v).toISOString() : "");
  const cancel = (
    <button
      type="submit"
      formAction={cancelMaintenance}
      formNoValidate
      data-testid="maintenance-cancel"
      className="oi-hover-dang"
      style={ghostDanger}
    >
      {t("alst.sp.cancelMaintenance")}
    </button>
  );
  return (
    <>
      <RowTrigger
        testId="maintenance-row"
        label={title}
        onOpen={() => setOpen(true)}
        style={rowStyle}
      >
        {children}
      </RowTrigger>
      {open && (
        <Frame
          title={editable ? t("sp2.editMaintenanceTitle") : title}
          testId="maintenance-edit-form"
          action={editable ? editMaintenance : cancellable ? cancelMaintenance : undefined}
          onClose={() => setOpen(false)}
          submit={
            editable ? t("common.save") : cancellable ? t("alst.sp.cancelMaintenance") : undefined
          }
          footerStart={editable && cancellable ? cancel : undefined}
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="pageId" value={pageId} />
          <fieldset
            disabled={!editable}
            style={{
              border: 0,
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 13,
            }}
          >
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
          </fieldset>
          {editable && <div style={note}>{t("sp2.editMaintenanceNote")}</div>}
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
