"use client";

import { useRef, useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import { flash } from "@/components/settings/controls";
import { dialogInputStyle, dialogSelectStyle } from "@/components/settings/dialog";
import { itemButtonStyle } from "@/components/settings/template";
import { addStatus, deleteStatus, moveStatus, saveStatus, type Done } from "./actions";
import { ListModal } from "./modal";
import { iconButtonStyle, listBoxStyle, listRowStyle } from "./styles";

export type StatusRow = {
  id: string;
  name: string;
  description: string | null;
  updateReminderMinutes: number | null;
  publicStatus: string | null;
  countsInMttr: boolean;
  /** Active incidents in it now. */
  inIt: number;
};

const REMINDERS = [15, 30, 60, 120];
const PUBLIC = ["investigating", "identified", "monitoring"] as const;

/**
 * The active statuses of a type, edited in place: in order, each with its
 * update reminder, the public status it maps to and whether it counts in
 * the MTTR; moved with the arrows, removed while no incident is in it, and
 * one more added at the end.
 */
export function StatusesModal({
  typeId,
  typeName,
  statuses,
  onClose,
}: {
  typeId: string;
  typeName: string;
  statuses: StatusRow[];
  onClose: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const newName = useRef<HTMLInputElement>(null);

  const run = (action: (fd: FormData) => Promise<Done>, fd: FormData, after?: () => void) =>
    start(async () => {
      const r = await action(fd);
      flash(r.ok ? r.message : r.error);
      if (r.ok) after?.();
    });
  const form = (o: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(o)) fd.set(k, v);
    return fd;
  };

  return (
    <ListModal
      title={t("settingsV2.types.statusesTitle", { type: typeName })}
      lead={t("settingsV2.types.statusesLead")}
      onClose={onClose}
      testId="statuses-dialog"
    >
      <div style={{ ...listBoxStyle, opacity: pending ? 0.7 : 1 }}>
        {statuses.map((st, i) => {
          const open = editing === st.id;
          const locked = st.inIt > 0 || statuses.length <= 1;
          return (
            <div key={st.id} data-testid="status-row" data-status={st.name}>
              <div
                style={{
                  ...listRowStyle(i === 0),
                  background: open ? "var(--brand-t)" : undefined,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {(["up", "down"] as const).map((dir) => {
                    const edge = dir === "up" ? i === 0 : i === statuses.length - 1;
                    return (
                      <button
                        key={dir}
                        type="button"
                        disabled={edge || pending}
                        aria-label={
                          dir === "up"
                            ? t("settingsV2.types.moveUp")
                            : t("settingsV2.types.moveDown")
                        }
                        data-testid={`status-${dir}`}
                        onClick={() => run(moveStatus, form({ statusId: st.id, typeId, dir }))}
                        style={{ ...iconButtonStyle(edge), width: 20, height: 14, fontSize: 8 }}
                      >
                        {dir === "up" ? "▲" : "▼"}
                      </button>
                    );
                  })}
                </div>
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 7,
                    background: "var(--sunk)",
                    display: "grid",
                    placeItems: "center",
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--ink-2)",
                    flex: "none",
                  }}
                >
                  {i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{st.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}>
                    {[
                      st.updateReminderMinutes
                        ? t("settings.types.statusMeta.reminder", {
                            minutes: st.updateReminderMinutes,
                          })
                        : t("settings.types.statusMeta.noReminder"),
                      st.publicStatus
                        ? t("settings.types.statusMeta.public", { status: st.publicStatus })
                        : t("settings.types.statusMeta.notPublic"),
                      st.countsInMttr
                        ? t("settings.types.statusMeta.mttr")
                        : t("settings.types.statusMeta.noMttr"),
                    ].join(" · ")}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
                  {t("settings.types.statusIncidents", { count: st.inIt })}
                </span>
                <button
                  type="button"
                  data-testid="status-edit"
                  onClick={() => setEditing(open ? null : st.id)}
                  className="oi-hover"
                  style={itemButtonStyle()}
                >
                  {open ? t("settingsV2.close") : t("settingsV2.edit")}
                </button>
                <button
                  type="button"
                  data-testid="status-delete"
                  disabled={locked || pending}
                  title={
                    st.inIt > 0
                      ? t("settings.types.errorStatusInUse")
                      : statuses.length <= 1
                        ? t("settings.types.errorLastStatus")
                        : t("settingsV2.remove")
                  }
                  aria-label={t("settingsV2.remove")}
                  onClick={() => run(deleteStatus, form({ statusId: st.id, typeId }))}
                  className={locked ? undefined : "oi-hover-dang"}
                  style={iconButtonStyle(locked, true)}
                >
                  ✕
                </button>
              </div>
              {open && (
                <form
                  data-testid="status-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(saveStatus, new FormData(e.currentTarget), () => setEditing(null));
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 10,
                    padding: "12px 12px 14px",
                    background: "var(--sunk)",
                    borderTop: "1px solid var(--line-2)",
                    alignItems: "end",
                  }}
                >
                  <input type="hidden" name="statusId" value={st.id} />
                  <Labelled label={t("settingsV2.types.statusName")}>
                    <input
                      name="name"
                      defaultValue={st.name}
                      required
                      maxLength={60}
                      className="oi-field"
                      style={dialogInputStyle()}
                    />
                  </Labelled>
                  <Labelled label={t("settingsV2.types.statusDescription")}>
                    <input
                      name="description"
                      defaultValue={st.description ?? ""}
                      maxLength={200}
                      className="oi-field"
                      style={dialogInputStyle()}
                    />
                  </Labelled>
                  <Labelled label={t("settingsV2.types.statusReminder")}>
                    <select
                      name="updateReminderMinutes"
                      defaultValue={String(st.updateReminderMinutes ?? "")}
                      className="oi-field"
                      style={dialogSelectStyle}
                    >
                      <option value="">{t("incident.update.noReminder")}</option>
                      {[
                        ...REMINDERS,
                        ...(st.updateReminderMinutes &&
                        !REMINDERS.includes(st.updateReminderMinutes)
                          ? [st.updateReminderMinutes]
                          : []),
                      ].map((m) => (
                        <option key={m} value={m}>
                          {t("incident.update.inMinutes", { count: m })}
                        </option>
                      ))}
                    </select>
                  </Labelled>
                  <Labelled label={t("settingsV2.types.statusPublic")}>
                    <select
                      name="publicStatus"
                      defaultValue={st.publicStatus ?? ""}
                      className="oi-field"
                      style={dialogSelectStyle}
                    >
                      <option value="">{t("settingsV2.types.statusPublicNone")}</option>
                      {PUBLIC.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </Labelled>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 500,
                      height: 36,
                      cursor: "pointer",
                    }}
                  >
                    <input type="checkbox" name="countsInMttr" defaultChecked={st.countsInMttr} />
                    {t("settingsV2.types.statusMttr")}
                  </label>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      type="submit"
                      disabled={pending}
                      data-testid="status-save"
                      className="oi-hover-brand-2"
                      style={smallPrimary}
                    >
                      {t("settingsV2.save")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          run(addStatus, fd, () => {
            if (newName.current) newName.current.value = "";
          });
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input type="hidden" name="typeId" value={typeId} />
        <input
          ref={newName}
          name="name"
          required
          maxLength={60}
          placeholder={t("settingsV2.types.statusPh")}
          aria-label={t("settingsV2.types.statusName")}
          data-testid="status-new"
          className="oi-field"
          style={{ ...dialogInputStyle(), flex: 1 }}
        />
        <button
          type="submit"
          disabled={pending}
          data-testid="status-add"
          className="oi-hover-brand-2"
          style={{ ...smallPrimary, height: 36 }}
        >
          {t("settingsV2.types.statusAdd")}
        </button>
      </form>
    </ListModal>
  );
}

const smallPrimary: React.CSSProperties = {
  height: 34,
  padding: "0 15px",
  borderRadius: 9,
  background: "var(--brand)",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  border: 0,
  whiteSpace: "nowrap",
};

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}
