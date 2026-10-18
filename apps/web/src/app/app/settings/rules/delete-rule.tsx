"use client";

import { useT } from "@/i18n/client";
import { SettingsDialog } from "@/components/settings/dialog";
import { pageActionStyle } from "@/components/settings/template";
import { deleteRuleFromDialog } from "./actions";

/** "Delete this rule" — asked once, in the template's dialog, then back to the list. */
export function DeleteRule({ id, n }: { id: string; n: number }) {
  const t = useT();
  return (
    <SettingsDialog
      testId="rule-delete-dialog"
      title={t("settingsV2.rules.deleteTitle", { n })}
      lead={t("settingsV2.rules.deleteLead")}
      primary={t("settingsV2.rules.delete")}
      danger
      action={deleteRuleFromDialog}
      trigger={(open) => (
        <button
          type="button"
          onClick={open}
          data-testid="rule-delete"
          className="oi-hover-dang"
          style={pageActionStyle(false, true)}
        >
          {t("settingsV2.rules.delete")}
        </button>
      )}
    >
      <input type="hidden" name="id" value={id} />
    </SettingsDialog>
  );
}
