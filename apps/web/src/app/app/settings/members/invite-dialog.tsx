"use client";

import { useT } from "@/i18n/client";
import {
  DialogField,
  SettingsDialog,
  dialogSelectStyle,
  dialogTextareaStyle,
} from "@/components/settings/dialog";
import { pageActionStyle } from "@/components/settings/template";
import { inviteMembers } from "./actions";

/** "+ Invite" — addresses separated by commas or lines, one role for the batch. */
export function InviteDialog({
  roles,
  domain,
}: {
  roles: Array<{ value: string; label: string }>;
  /** The inviter's own email domain, for the placeholder. */
  domain: string;
}) {
  const t = useT();
  return (
    <SettingsDialog
      testId="invite-form"
      title={t("settingsV2.members.dialog.title")}
      lead={t("settingsV2.members.dialog.lead")}
      primary={t("settingsV2.members.dialog.primary")}
      action={inviteMembers}
      trigger={(open) => (
        <button
          type="button"
          data-testid="invite-open"
          onClick={open}
          className="oi-hover-brand-2"
          style={pageActionStyle(true)}
        >
          {t("settingsV2.members.invite")}
        </button>
      )}
    >
      <DialogField
        label={t("settingsV2.members.dialog.emails")}
        help={t("settingsV2.members.dialog.emailsHelp")}
      >
        <textarea
          name="emails"
          rows={3}
          required
          autoFocus
          placeholder={`sofia@${domain}, ben@${domain}`}
          className="oi-field"
          style={dialogTextareaStyle}
        />
      </DialogField>
      <DialogField label={t("settingsV2.members.dialog.role")}>
        <select name="role" defaultValue="responder" className="oi-field" style={dialogSelectStyle}>
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </DialogField>
    </SettingsDialog>
  );
}
