"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import {
  DialogField,
  DialogReadOnly,
  SettingsDialog,
  dialogInputStyle,
  dialogSelectStyle,
} from "@/components/settings/dialog";
import { itemButtonStyle, pageActionStyle } from "@/components/settings/template";
import { DeleteIntent } from "../types/delete-intent";
import { saveField } from "./actions";

const FIELD_KINDS = ["select", "text", "long_text", "number", "link"] as const;
type Kind = (typeof FIELD_KINDS)[number] | "multi_select" | "catalog_entry";

export type FieldValues = {
  id: string;
  key: string;
  name: string;
  kind: Kind;
  options: string[];
  required: boolean;
  typeId: string | null;
};

/** "+ New field" and "Edit <field>": name, kind, options, required, types. */
export function FieldDialog({
  field,
  types,
}: {
  field?: FieldValues;
  types: Array<{ id: string; name: string }>;
}) {
  const t = useT();
  const [kind, setKind] = useState<Kind>(field?.kind ?? "select");
  return (
    <SettingsDialog
      testId={field ? "field-edit-dialog" : "field-form"}
      title={
        field
          ? t("settingsV2.fields.editTitle", { name: field.name })
          : t("settingsV2.fields.newTitle")
      }
      primary={field ? t("settingsV2.save") : t("settingsV2.fields.addBtn")}
      action={saveField}
      trigger={(open) =>
        field ? (
          <button
            type="button"
            onClick={() => {
              setKind(field.kind);
              open();
            }}
            data-testid="field-edit"
            className="oi-hover"
            style={itemButtonStyle()}
          >
            {t("settingsV2.edit")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setKind("select");
              open();
            }}
            data-testid="field-open"
            className="oi-hover-brand-2"
            style={pageActionStyle(true)}
          >
            {t("settingsV2.fields.new")}
          </button>
        )
      }
    >
      <input type="hidden" name="id" value={field?.id ?? ""} />
      <DialogField
        label={t("settingsV2.fields.name")}
        help={field ? undefined : t("settingsV2.fields.nameHelp")}
      >
        <input
          name="name"
          required
          maxLength={80}
          defaultValue={field?.name ?? ""}
          placeholder={t("settingsV2.fields.namePh")}
          className="oi-field"
          style={dialogInputStyle()}
        />
      </DialogField>
      {field && (
        <DialogReadOnly label={t("settingsV2.fields.apiName")}>
          <span style={{ fontFamily: "var(--mono)" }}>{field.key}</span>
        </DialogReadOnly>
      )}
      <DialogField
        label={t("settingsV2.fields.kindLabel")}
        help={field ? t("settingsV2.fields.kindFixed") : undefined}
      >
        <select
          name="kind"
          value={kind}
          disabled={Boolean(field)}
          onChange={(e) => setKind(e.currentTarget.value as Kind)}
          className="oi-field"
          style={dialogSelectStyle}
        >
          {[...FIELD_KINDS, ...(FIELD_KINDS.some((k) => k === kind) ? [] : [kind])].map((k) => (
            <option key={k} value={k}>
              {t(`settingsV2.fields.kind.${k}`)}
            </option>
          ))}
        </select>
      </DialogField>
      {kind === "select" && (
        <DialogField
          label={t("settingsV2.fields.options")}
          help={t("settingsV2.fields.optionsHelp")}
        >
          <input
            name="options"
            required
            defaultValue={field?.options.join(", ") ?? ""}
            placeholder={t("settingsV2.fields.optionsPh")}
            className="oi-field"
            style={dialogInputStyle()}
          />
        </DialogField>
      )}
      <DialogField label={t("settingsV2.fields.requiredLabel")}>
        <select
          name="required"
          defaultValue={field?.required ? "required" : "optional"}
          className="oi-field"
          style={dialogSelectStyle}
        >
          <option value="optional">{t("settingsV2.fields.optional")}</option>
          <option value="required">{t("settingsV2.fields.required")}</option>
        </select>
      </DialogField>
      <DialogField label={t("settingsV2.fields.types")}>
        <select
          name="types"
          defaultValue={field?.typeId ?? ""}
          className="oi-field"
          style={dialogSelectStyle}
        >
          <option value="">{t("settingsV2.fields.allTypes")}</option>
          {types.map((ty) => (
            <option key={ty.id} value={ty.id}>
              {ty.name}
            </option>
          ))}
        </select>
      </DialogField>
      {field && <DeleteIntent label={t("settingsV2.fields.delete")} testId="field-delete" />}
    </SettingsDialog>
  );
}
