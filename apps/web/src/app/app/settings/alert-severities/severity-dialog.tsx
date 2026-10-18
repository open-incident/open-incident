"use client";

import { useT } from "@/i18n/client";
import {
  DialogField,
  DialogSegmented,
  DialogToggle,
  SettingsDialog,
  dialogInputStyle,
  dialogSelectStyle,
} from "@/components/settings/dialog";
import { itemButtonStyle } from "@/components/settings/template";
import { saveSeverity } from "./actions";
import { COLOURS, COLOUR_LABELS } from "./colours";

export type SeverityValues = {
  id: string;
  name: string;
  description: string;
  urgency: "high" | "low";
  color: string;
  aliases: string[];
  isDefault: boolean;
};

/** "Edit P1" — the real columns of a level; the change applies to new alerts only. */
export function SeverityDialog({ level, disabled }: { level: SeverityValues; disabled?: boolean }) {
  const t = useT();
  const colours: string[] = COLOURS.includes(level.color as (typeof COLOURS)[number])
    ? [...COLOURS]
    : [...COLOURS, level.color];
  return (
    <SettingsDialog
      testId="severity-dialog"
      title={t("settingsV2.asev.editTitle", { name: level.name })}
      lead={t("settingsV2.asev.editLead")}
      primary={t("settingsV2.save")}
      action={saveSeverity}
      trigger={(open) => (
        <button
          type="button"
          onClick={open}
          disabled={disabled}
          data-testid="severity-edit"
          className="oi-hover"
          style={itemButtonStyle()}
        >
          {t("settingsV2.edit")}
        </button>
      )}
    >
      <input type="hidden" name="id" value={level.id} />
      <DialogField label={t("settingsV2.asev.name")}>
        <input
          name="name"
          required
          maxLength={12}
          defaultValue={level.name}
          data-testid="severity-name"
          className="oi-field"
          style={dialogInputStyle()}
        />
      </DialogField>
      <DialogField label={t("settingsV2.asev.description")}>
        <input
          name="description"
          maxLength={160}
          defaultValue={level.description}
          placeholder={t("settingsV2.asev.descriptionPh")}
          data-testid="severity-description"
          className="oi-field"
          style={dialogInputStyle()}
        />
      </DialogField>
      <DialogSegmented
        label={t("settingsV2.asev.urgency")}
        name="urgency"
        defaultValue={level.urgency}
        options={[
          { value: "high", label: t("settingsV2.asev.urgencyHigh") },
          { value: "low", label: t("settingsV2.asev.urgencyLow") },
        ]}
      />
      <DialogField label={t("settingsV2.asev.aliases")} help={t("settingsV2.asev.aliasesHelp")}>
        <input
          name="aliases"
          maxLength={400}
          defaultValue={level.aliases.join(", ")}
          data-testid="severity-aliases"
          className="oi-field"
          style={dialogInputStyle(true)}
        />
      </DialogField>
      <DialogField label={t("settingsV2.asev.colour")}>
        <select
          name="color"
          defaultValue={level.color}
          className="oi-field"
          style={dialogSelectStyle}
        >
          {colours.map((c) => (
            <option key={c} value={c}>
              {c in COLOUR_LABELS ? t(COLOUR_LABELS[c as keyof typeof COLOUR_LABELS]) : c}
            </option>
          ))}
        </select>
      </DialogField>
      <DialogToggle
        name="isDefault"
        label={t("settingsV2.asev.isDefault")}
        defaultChecked={level.isDefault}
        testId="severity-default"
      />
    </SettingsDialog>
  );
}
