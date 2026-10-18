"use client";

import { useT } from "@/i18n/client";
import { DialogField, SettingsDialog, dialogInputStyle } from "@/components/settings/dialog";
import { Toggle } from "@/components/settings/controls";
import { itemButtonStyle, pageActionStyle } from "@/components/settings/template";
import { saveSeverity } from "./actions";

export type SeverityValues = {
  id: string;
  name: string;
  description: string | null;
  startsPost: boolean;
  proposes: boolean;
  /** The worst severity: always proposed, the threshold cannot go above it. */
  worst: boolean;
};

/** "+ Add severity" and "Edit SEV1" — the same four rows. */
export function SeverityDialog({
  severity,
  page,
}: {
  severity?: SeverityValues;
  /** The status page whose threshold decides the proposals; null when there is none. */
  page: string | null;
}) {
  const t = useT();
  const locked = !page || Boolean(severity?.worst && severity.proposes);
  return (
    <SettingsDialog
      testId={severity ? "sev-edit-dialog" : "sev-new-dialog"}
      title={
        severity
          ? t("settingsV2.sev.editTitle", { name: severity.name })
          : t("settingsV2.sev.newTitle")
      }
      primary={severity ? t("settingsV2.save") : t("settingsV2.sev.addAtEnd")}
      action={saveSeverity}
      trigger={(open) =>
        severity ? (
          <button
            type="button"
            onClick={open}
            data-testid="sev-edit"
            className="oi-hover"
            style={itemButtonStyle()}
          >
            {t("settingsV2.edit")}
          </button>
        ) : (
          <button
            type="button"
            onClick={open}
            data-testid="sev-new"
            className="oi-hover-brand-2"
            style={pageActionStyle(true)}
          >
            {t("settingsV2.sev.add")}
          </button>
        )
      }
    >
      <input type="hidden" name="severityId" value={severity?.id ?? ""} />
      <DialogField label={t("settingsV2.sev.name")}>
        <input
          name="name"
          required
          maxLength={20}
          defaultValue={severity?.name ?? ""}
          placeholder={t("settingsV2.sev.namePh")}
          className="oi-field"
          style={dialogInputStyle()}
        />
      </DialogField>
      <DialogField
        label={t("settingsV2.sev.description")}
        help={t("settingsV2.sev.descriptionHelp")}
      >
        <input
          name="description"
          maxLength={200}
          defaultValue={severity?.description ?? ""}
          placeholder={t("settingsV2.sev.descriptionPh")}
          className="oi-field"
          style={dialogInputStyle()}
        />
      </DialogField>
      <DialogSwitch
        name="startsPost"
        label={t("settingsV2.sev.startsPost")}
        help={t("settingsV2.sev.startsPostHelp")}
        defaultChecked={severity?.startsPost ?? false}
        testId="sev-starts-post"
      />
      <DialogSwitch
        name="proposes"
        label={t("settingsV2.sev.proposes")}
        help={page ? t("settingsV2.sev.proposesHelp", { page }) : t("settingsV2.sev.proposesNone")}
        defaultChecked={severity?.proposes ?? false}
        disabled={locked}
        testId="sev-proposes"
      />
      {locked && <input type="hidden" name="proposes" value="keep" />}
    </SettingsDialog>
  );
}

/** A switch row of a dialog that can also be shown disabled, with why under it. */
function DialogSwitch({
  name,
  label,
  help,
  defaultChecked,
  disabled,
  testId,
}: {
  name: string;
  label: string;
  help?: string;
  defaultChecked: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{label}</span>
        <Toggle
          name={name}
          label={label}
          defaultChecked={defaultChecked}
          disabled={disabled}
          showState={false}
          testId={testId}
        />
      </div>
      {help && (
        <span style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45 }}>{help}</span>
      )}
    </div>
  );
}
