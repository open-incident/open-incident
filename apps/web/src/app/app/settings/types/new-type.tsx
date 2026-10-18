"use client";

import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import {
  DialogField,
  SettingsDialog,
  dialogInputStyle,
  dialogSelectStyle,
  type DialogAction,
} from "@/components/settings/dialog";
import { pageActionStyle } from "@/components/settings/template";
import { createType } from "./actions";

/** "+ New type": a name, and the type it copies. The screen then opens on it. */
export function NewTypeDialog({
  types,
}: {
  types: Array<{ id: string; name: string; isDefault: boolean }>;
}) {
  const t = useT();
  const router = useRouter();
  const action: DialogAction = async (_prev, fd) => {
    const r = await createType(null, fd);
    if (!r.ok) return r;
    router.push(r.href, { scroll: false });
    return { ok: true, message: r.message };
  };
  return (
    <SettingsDialog
      testId="type-form"
      title={t("settingsV2.types.newTitle")}
      lead={t("settingsV2.types.newLead")}
      primary={t("settingsV2.types.create")}
      action={action}
      trigger={(open) => (
        <button
          type="button"
          onClick={open}
          data-testid="type-open"
          className="oi-hover-brand-2"
          style={pageActionStyle(true)}
        >
          {t("settingsV2.types.new")}
        </button>
      )}
    >
      <DialogField label={t("settingsV2.types.name")}>
        <input
          name="name"
          required
          minLength={2}
          maxLength={60}
          autoFocus
          placeholder={t("settingsV2.types.newNamePh")}
          className="oi-field"
          style={dialogInputStyle()}
        />
      </DialogField>
      <DialogField label={t("settingsV2.types.copyFrom")}>
        <select
          name="baseTypeId"
          defaultValue={types.find((x) => x.isDefault)?.id ?? types[0]?.id}
          className="oi-field"
          style={dialogSelectStyle}
        >
          {types.map((ty) => (
            <option key={ty.id} value={ty.id}>
              {ty.name}
            </option>
          ))}
        </select>
      </DialogField>
    </SettingsDialog>
  );
}
