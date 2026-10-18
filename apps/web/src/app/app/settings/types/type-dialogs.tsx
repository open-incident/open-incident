"use client";

import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import {
  DialogField,
  SettingsDialog,
  dialogInputStyle,
  type DialogAction,
} from "@/components/settings/dialog";
import { Segmented, flash } from "@/components/settings/controls";
import { rowButtonStyle } from "@/components/settings/template";
import { TemplateEditor } from "../post-incident/template-editor";
import { deleteType, saveDeclareForm, savePostMortem } from "./actions";
import { listBoxStyle, listRowStyle } from "./styles";

function RowButton({
  onClick,
  label,
  testId,
  danger,
}: {
  onClick: () => void;
  label: string;
  testId: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={danger ? "oi-hover-dang" : "oi-hover"}
      style={rowButtonStyle(danger)}
    >
      {label}
    </button>
  );
}

/** Deleting a type nobody used — the screen then opens on the default type. */
export function DeleteTypeDialog({ typeId, typeName }: { typeId: string; typeName: string }) {
  const t = useT();
  const router = useRouter();
  const action: DialogAction = async (_prev, fd) => {
    const r = await deleteType(null, fd);
    if (!r.ok) return r;
    // The screen re-renders on the default type at once: this dialog may be
    // gone before it could say anything, so the toast is said from here.
    flash(r.message);
    router.push(r.href, { scroll: false });
    return { ok: true };
  };
  return (
    <SettingsDialog
      testId="type-delete-dialog"
      title={t("settingsV2.types.deleteTitle", { type: typeName })}
      lead={t("settingsV2.types.deleteLead")}
      primary={t("settingsV2.types.deleteBtn")}
      danger
      action={action}
      trigger={(open) => (
        <RowButton
          onClick={open}
          label={t("settingsV2.types.delete")}
          testId="type-delete"
          danger
        />
      )}
    >
      <input type="hidden" name="typeId" value={typeId} />
    </SettingsDialog>
  );
}

export type FormFieldChoice = {
  key: string;
  name: string;
  /** A custom field: its API name is shown in mono beside its label. */
  custom: boolean;
  ask: "required" | "optional" | "off";
};

/** What declaring the type asks: one choice per field, the title always. */
export function DeclareFormDialog({
  typeId,
  typeName,
  fields,
}: {
  typeId: string;
  typeName: string;
  fields: FormFieldChoice[];
}) {
  const t = useT();
  return (
    <SettingsDialog
      testId="declare-form-dialog"
      title={t("settingsV2.types.formTitle", { type: typeName })}
      lead={t("settingsV2.types.formLead")}
      primary={t("settingsV2.save")}
      action={saveDeclareForm}
      trigger={(open) => (
        <RowButton
          onClick={open}
          label={t("settingsV2.types.editBtn")}
          testId="declare-form-edit"
        />
      )}
    >
      <input type="hidden" name="typeId" value={typeId} />
      <div style={listBoxStyle}>
        {fields.map((f, i) => (
          <div
            key={f.key}
            data-testid="form-field"
            style={{ ...listRowStyle(i === 0), flexWrap: "wrap" }}
          >
            <span style={{ flex: "1 1 160px", minWidth: 0, fontWeight: 600 }}>
              {f.name}
              {f.custom && (
                <span
                  style={{
                    marginLeft: 8,
                    fontFamily: "var(--mono)",
                    fontWeight: 400,
                    fontSize: 11.5,
                    color: "var(--ink-3)",
                  }}
                >
                  {f.key}
                </span>
              )}
            </span>
            <Segmented
              name={`ask.${f.key}`}
              defaultValue={f.ask}
              options={(["required", "optional", "off"] as const).map((v) => ({
                value: v,
                label: t(`settings.types.ask.${v}`),
              }))}
            />
          </div>
        ))}
      </div>
    </SettingsDialog>
  );
}

/** The post-mortem's word and sections — shared by every type. */
export function TemplateDialog({
  sections,
  isDefault,
  term,
  placeholder,
}: {
  sections: Array<{ key: string; title: string; hint: string }>;
  isDefault: boolean;
  term: string;
  placeholder: string;
}) {
  const t = useT();
  return (
    <SettingsDialog
      testId="pm-template-dialog"
      title={t("settingsV2.types.pmTitle")}
      lead={t("settingsV2.types.pmLead")}
      primary={t("settingsV2.save")}
      action={savePostMortem}
      trigger={(open) => (
        <RowButton onClick={open} label={t("settingsV2.types.editBtn")} testId="pm-template-edit" />
      )}
    >
      <DialogField label={t("settingsV2.types.pmTerm")} help={t("settingsV2.types.pmTermHelp")}>
        <input
          name="term"
          defaultValue={term}
          placeholder={placeholder}
          maxLength={40}
          className="oi-field"
          style={dialogInputStyle()}
        />
      </DialogField>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{t("settingsV2.types.pmSections")}</span>
        <TemplateEditor sections={sections} isDefault={isDefault} canManage />
      </div>
    </SettingsDialog>
  );
}
