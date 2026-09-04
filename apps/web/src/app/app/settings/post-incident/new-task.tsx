"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { createTask } from "./actions";

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

/** "+ Add a task" — title, phase as a segmented control, default assignee, due delay. */
export function NewTaskDialog({ phase: initial }: { phase: "documenting" | "reviewing" }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState(initial);
  return (
    <>
      <button
        type="button"
        data-testid={`task-open-${initial}`}
        onClick={() => {
          setPhase(initial);
          setOpen(true);
        }}
        className="oi-hover"
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          padding: "9px 16px",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--brand)",
          background: "transparent",
          border: 0,
          cursor: "pointer",
        }}
      >
        {t("settings.postIncident.addTask")}
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
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
            data-testid="task-form"
            action={createTask}
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
                {t("settings.postIncident.newTaskTitle")}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
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
            <div
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 13 }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.postIncident.taskTitle")}</span>
                <input
                  name="title"
                  required
                  autoFocus
                  maxLength={200}
                  placeholder={t("settings.postIncident.taskPlaceholder")}
                  className="oi-field"
                  style={control}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.postIncident.phase")}</span>
                  <div
                    role="radiogroup"
                    style={{
                      display: "flex",
                      gap: 2,
                      background: "var(--sunk)",
                      borderRadius: 9,
                      padding: 3,
                    }}
                  >
                    {(["documenting", "reviewing"] as const).map((p, i) => (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={phase === p}
                        onClick={() => setPhase(p)}
                        style={{
                          flex: 1,
                          padding: "6px 0",
                          borderRadius: 7,
                          border: 0,
                          background: phase === p ? "var(--panel)" : "transparent",
                          fontSize: 12,
                          fontWeight: phase === p ? 600 : 500,
                          color: phase === p ? "var(--ink)" : "var(--ink-3)",
                          boxShadow: phase === p ? "var(--shadow-card)" : "none",
                          cursor: "pointer",
                        }}
                      >
                        {i + 1} · {t(`postIncident.phase.${p}`)}
                      </button>
                    ))}
                  </div>
                  <input type="hidden" name="phase" value={phase} />
                </div>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("settings.postIncident.assignedTo")}</span>
                  <select
                    name="defaultAssigneeRole"
                    defaultValue="lead"
                    className="oi-field"
                    style={control}
                  >
                    <option value="lead">{t("settings.postIncident.assignee.lead")}</option>
                    <option value="communication">
                      {t("settings.postIncident.assignee.communication")}
                    </option>
                    <option value="none">{t("settings.postIncident.assignee.none")}</option>
                  </select>
                </label>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("settings.postIncident.dueAfterLabel")}</span>
                <input
                  name="dueAfterDays"
                  type="number"
                  min={1}
                  max={90}
                  placeholder="7"
                  className="oi-field"
                  style={{ ...control, width: 120 }}
                />
              </label>
              <div
                className="oi-note"
                style={{ borderRadius: 11, padding: "11px 13px", fontSize: 12 }}
              >
                {t("settings.postIncident.taskNote")}
              </div>
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
                onClick={() => setOpen(false)}
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
                {t("common.create")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
