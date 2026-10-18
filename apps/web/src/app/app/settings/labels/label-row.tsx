"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import {
  DialogField,
  DialogToggle,
  SettingsDialog,
  dialogInputStyle,
  dialogSelectStyle,
} from "@/components/settings/dialog";
import { Chip, type ChipSpec } from "@/components/settings/template";
import { saveLabel } from "./actions";

export type LabelSettings = {
  key: string;
  label: string;
  type: "text" | "list" | "priority" | "service" | "team";
  required: boolean;
  mergeStrategy: "first" | "last" | "accumulate" | "max";
};

/**
 * One observed label, on the list card's row template — the key in mono, its
 * values, what it ties to, how many alerts carry it. For a manager the row
 * opens how the pipeline reads the key.
 */
export function LabelRow({
  settings,
  sub,
  chips,
  right,
  muted,
  editable,
}: {
  settings: LabelSettings;
  sub: string;
  chips: Array<ChipSpec & { label: string }>;
  right: string;
  muted?: boolean;
  editable: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        data-testid="label-row"
        data-key={settings.key}
        role={editable ? "button" : undefined}
        tabIndex={editable ? 0 : undefined}
        onClick={editable ? () => setOpen(true) : undefined}
        onKeyDown={
          editable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen(true);
                }
              }
            : undefined
        }
        className={editable ? "oi-hover oi-focus" : "oi-hover"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "11px 18px",
          borderTop: "1px solid var(--line-2)",
          cursor: editable ? "pointer" : "default",
          flexWrap: "wrap",
          opacity: muted ? 0.6 : 1,
        }}
      >
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              fontFamily: "var(--mono)",
              lineHeight: 1.45,
              overflowWrap: "anywhere",
            }}
          >
            {settings.key}
          </div>
          {sub && (
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-3)",
                marginTop: 1,
                lineHeight: 1.45,
                overflowWrap: "anywhere",
              }}
            >
              {sub}
            </div>
          )}
        </div>
        {chips.length > 0 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
            {chips.map((c, i) => (
              <Chip key={i} tone={c.tone} testId={c.testId}>
                {c.label}
              </Chip>
            ))}
          </div>
        )}
        <span style={{ fontSize: 12, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{right}</span>
      </div>
      {editable && (
        <SettingsDialog
          open={open}
          onOpenChange={setOpen}
          testId="label-dialog"
          title={t("settingsV2.labels.editTitle", { key: settings.key })}
          lead={t("settingsV2.labels.editLead")}
          primary={t("settingsV2.save")}
          action={saveLabel}
        >
          <input type="hidden" name="key" value={settings.key} />
          <DialogField label={t("settingsV2.labels.display")}>
            <input
              name="label"
              required
              maxLength={60}
              defaultValue={settings.label}
              data-testid="label-display"
              className="oi-field"
              style={dialogInputStyle()}
            />
          </DialogField>
          <DialogField label={t("settingsV2.labels.kind")} help={t("settingsV2.labels.kindHelp")}>
            <select
              name="type"
              defaultValue={settings.type}
              data-testid="label-kind"
              className="oi-field"
              style={dialogSelectStyle}
            >
              <option value="text">{t("settingsV2.labels.kindText")}</option>
              <option value="list">{t("settingsV2.labels.kindList")}</option>
              <option value="priority">{t("settingsV2.labels.kindSeverity")}</option>
              <option value="service">{t("settingsV2.labels.kindService")}</option>
              <option value="team">{t("settingsV2.labels.kindTeam")}</option>
            </select>
          </DialogField>
          <DialogToggle
            name="required"
            label={t("settingsV2.labels.required")}
            help={t("settingsV2.labels.requiredHelp")}
            defaultChecked={settings.required}
            testId="label-required"
          />
          <DialogField label={t("settingsV2.labels.repeat")}>
            <select
              name="mergeStrategy"
              defaultValue={settings.mergeStrategy}
              className="oi-field"
              style={dialogSelectStyle}
            >
              <option value="last">{t("settingsV2.labels.repeatLast")}</option>
              <option value="first">{t("settingsV2.labels.repeatFirst")}</option>
              <option value="accumulate">{t("settingsV2.labels.repeatAccumulate")}</option>
              <option value="max">{t("settingsV2.labels.repeatMax")}</option>
            </select>
          </DialogField>
        </SettingsDialog>
      )}
    </>
  );
}
