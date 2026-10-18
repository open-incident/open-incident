"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useT } from "@/i18n/client";
import { flash } from "@/components/settings/controls";
import {
  DialogField,
  SettingsDialog,
  dialogInputStyle,
  dialogSelectStyle,
  type DialogResult,
} from "@/components/settings/dialog";
import { itemButtonStyle, pageActionStyle } from "@/components/settings/template";
import { createRoleAction, editRoleAction, removeRoleAction } from "./actions";

function RoleFields({
  name = "",
  description = "",
  base = "responder",
}: {
  name?: string;
  description?: string;
  base?: string;
}) {
  const t = useT();
  return (
    <>
      <DialogField label={t("settingsV2.roles.dialog.name")}>
        <input
          name="name"
          required
          autoFocus
          maxLength={60}
          defaultValue={name}
          placeholder={t("settingsV2.roles.dialog.namePh")}
          className="oi-field"
          style={dialogInputStyle()}
        />
      </DialogField>
      <DialogField label={t("settingsV2.roles.dialog.description")}>
        <input
          name="description"
          maxLength={300}
          defaultValue={description}
          placeholder={t("settingsV2.roles.dialog.descriptionPh")}
          className="oi-field"
          style={dialogInputStyle()}
        />
      </DialogField>
      <DialogField
        label={t("settingsV2.roles.dialog.base")}
        help={t("settingsV2.roles.dialog.baseHelp")}
      >
        <select name="base" defaultValue={base} className="oi-field" style={dialogSelectStyle}>
          <option value="responder">{t("member.role.responder")}</option>
          <option value="viewer">{t("member.role.viewer")}</option>
          <option value="admin">{t("member.role.admin")}</option>
        </select>
      </DialogField>
    </>
  );
}

/** "+ New role" — created from its base's permissions, then selected in the matrix. */
export function NewRoleDialog() {
  const t = useT();
  const router = useRouter();
  const action = async (prev: DialogResult, formData: FormData): Promise<DialogResult> => {
    const res = await createRoleAction(prev, formData);
    if (res && res.ok && res.id)
      router.replace(`/app/settings/roles?role=${res.id}`, { scroll: false });
    return res;
  };
  return (
    <SettingsDialog
      testId="role-dialog"
      title={t("settingsV2.roles.dialog.title")}
      lead={t("settingsV2.roles.dialog.lead")}
      primary={t("settingsV2.roles.dialog.primary")}
      action={action}
      trigger={(open) => (
        <button
          type="button"
          data-testid="role-add"
          onClick={open}
          className="oi-hover-brand-2"
          style={pageActionStyle(true)}
        >
          {t("settingsV2.roles.new")}
        </button>
      )}
    >
      <RoleFields />
    </SettingsDialog>
  );
}

/** Rename a role, reword it, or move it to another base. */
export function EditRoleDialog({
  role,
}: {
  role: { id: string; name: string; description: string; base: string };
}) {
  const t = useT();
  return (
    <SettingsDialog
      testId="role-edit-dialog"
      title={t("settingsV2.roles.dialog.editTitle", { name: role.name })}
      primary={t("settingsV2.roles.dialog.save")}
      action={editRoleAction}
      trigger={(open) => (
        <button
          type="button"
          data-testid="role-edit"
          onClick={open}
          className="oi-hover"
          style={itemButtonStyle()}
        >
          {t("settingsV2.roles.edit")}
        </button>
      )}
    >
      <input type="hidden" name="id" value={role.id} />
      <RoleFields name={role.name} description={role.description} base={role.base} />
    </SettingsDialog>
  );
}

/** Deleted at once — or refused, naming who still holds it. */
export function DeleteRoleButton({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      data-testid="role-remove"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set("id", id);
          const res = await removeRoleAction(fd);
          if (res.ok) {
            flash(res.message);
            router.replace("/app/settings/roles", { scroll: false });
          } else flash(res.error);
        })
      }
      className="oi-hover-dang"
      style={{ ...itemButtonStyle("dang"), opacity: pending ? 0.6 : 1 }}
    >
      {t("settingsV2.roles.delete")}
    </button>
  );
}
