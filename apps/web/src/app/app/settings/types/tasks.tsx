"use client";

import { useRef, useTransition } from "react";
import { useT } from "@/i18n/client";
import { flash } from "@/components/settings/controls";
import { dialogInputStyle, dialogSelectStyle } from "@/components/settings/dialog";
import { createTask, deleteTask } from "../post-incident/actions";
import { ListModal } from "./modal";
import { iconButtonStyle, listBoxStyle, listRowStyle } from "./styles";

export type TaskRow = {
  id: string;
  phase: "documenting" | "reviewing";
  title: string;
  defaultAssigneeRole: string | null;
  dueAfterDays: number | null;
};

const PHASES = ["documenting", "reviewing"] as const;

/**
 * The post-incident flow's tasks — the same for every type: the two phases,
 * each with its tasks (title, who gets it, how many days to do it), one
 * removed or added on the spot.
 */
export function TasksModal({ tasks, onClose }: { tasks: TaskRow[]; onClose: () => void }) {
  const t = useT();
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const assignee = (role: string | null) =>
    role === "lead" || role === "communication"
      ? t(`settings.postIncident.assignee.${role}`)
      : t("settings.postIncident.assignee.none");

  return (
    <ListModal
      title={t("settingsV2.types.tasksTitle")}
      lead={t("settingsV2.types.tasksLead")}
      onClose={onClose}
      testId="tasks-dialog"
    >
      {PHASES.map((phase) => {
        const rows = tasks.filter((x) => x.phase === phase);
        return (
          <div key={phase} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "var(--brand)",
              }}
            >
              {t(`settingsV2.types.chip.${phase}`)}
            </span>
            <div style={{ ...listBoxStyle, opacity: pending ? 0.7 : 1 }}>
              {rows.map((d, i) => (
                <div key={d.id} data-testid="task-def-row" style={listRowStyle(i === 0)}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{d.title}</span>
                    <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
                      {` — ${assignee(d.defaultAssigneeRole)}`}
                      {d.dueAfterDays
                        ? ` · ${t("settings.postIncident.dueAfter", { count: d.dueAfterDays })}`
                        : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    data-testid="task-delete"
                    aria-label={t("settingsV2.remove")}
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const fd = new FormData();
                        fd.set("id", d.id);
                        const r = await deleteTask(fd);
                        flash(r.ok ? r.message : r.error);
                      })
                    }
                    className="oi-hover-dang"
                    style={iconButtonStyle(false, true)}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {rows.length === 0 && (
                <div style={{ ...listRowStyle(true), color: "var(--ink-3)", fontSize: 12.5 }}>
                  —
                </div>
              )}
            </div>
          </div>
        );
      })}
      <form
        ref={formRef}
        data-testid="task-form"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await createTask(fd);
            flash(r.ok ? r.message : r.error);
            if (r.ok) formRef.current?.reset();
          });
        }}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 10,
          padding: "12px",
          borderRadius: 12,
          background: "var(--sunk)",
          alignItems: "end",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1" }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{t("settingsV2.types.taskAdd")}</span>
          <input
            name="title"
            required
            maxLength={200}
            placeholder={t("settingsV2.types.taskPh")}
            aria-label={t("settingsV2.types.taskTitle")}
            className="oi-field"
            style={dialogInputStyle()}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {t("settingsV2.types.taskAssignee")}
          </span>
          <select
            name="defaultAssigneeRole"
            defaultValue="lead"
            className="oi-field"
            style={dialogSelectStyle}
          >
            <option value="lead">{t("settings.postIncident.assignee.lead")}</option>
            <option value="communication">
              {t("settings.postIncident.assignee.communication")}
            </option>
            <option value="none">{t("settings.postIncident.assignee.none")}</option>
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{t("settingsV2.types.taskPhase")}</span>
          <select
            name="phase"
            defaultValue="reviewing"
            className="oi-field"
            style={dialogSelectStyle}
          >
            {PHASES.map((p) => (
              <option key={p} value={p}>
                {t(`settingsV2.types.chip.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{t("settingsV2.types.taskDue")}</span>
          <input
            name="dueAfterDays"
            type="number"
            min={1}
            max={90}
            placeholder="7"
            className="oi-field"
            style={dialogInputStyle()}
          />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            disabled={pending}
            data-testid="task-add"
            className="oi-hover-brand-2"
            style={{
              height: 36,
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
            }}
          >
            {t("settingsV2.types.statusAdd")}
          </button>
        </div>
      </form>
    </ListModal>
  );
}
