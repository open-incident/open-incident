"use client";

import { useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import { flash } from "@/components/settings/controls";
import { SettingsDialog } from "@/components/settings/dialog";
import { pageActionClass, pageActionStyle, rowButtonStyle } from "@/components/settings/template";
import { issueScim, toggleScim } from "./actions";

/** The header's Disable / Enable: the door closes (401) or opens; members stay as they are. */
export function ScimToggle({ enabled, provider }: { enabled: boolean; provider: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      data-testid="scim-toggle"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set("enabled", enabled ? "" : "on");
          const res = await toggleScim(fd);
          flash(
            !res.ok
              ? res.error
              : res.enabled
                ? t("settingsV2.scim.flash.enabled", { provider })
                : t("settingsV2.scim.flash.disabled", { provider }),
          );
        })
      }
      className={pageActionClass(false, enabled)}
      style={{ ...pageActionStyle(false, enabled), opacity: pending ? 0.7 : 1 }}
    >
      {enabled ? t("settingsV2.scim.disable") : t("settingsV2.scim.enable")}
    </button>
  );
}

/**
 * "Rotate…" — or "Issue a token…" the first time: the dialog says what
 * happens, then shows the new token once.
 */
export function TokenDialog({ rotate, provider }: { rotate: boolean; provider: string }) {
  const t = useT();
  // Fixed when the dialog opens: the page redraws as "rotate" once the first token exists.
  const [first, setFirst] = useState(!rotate);
  return (
    <SettingsDialog
      testId="scim-token-dialog"
      title={
        !first ? t("settingsV2.scim.dialog.rotateTitle") : t("settingsV2.scim.dialog.issueTitle")
      }
      lead={
        !first
          ? t("settingsV2.scim.dialog.rotateLead", { provider })
          : t("settingsV2.scim.dialog.issueLead", { provider })
      }
      primary={
        !first
          ? t("settingsV2.scim.dialog.rotatePrimary")
          : t("settingsV2.scim.dialog.issuePrimary")
      }
      action={issueScim}
      trigger={(open) => (
        <button
          type="button"
          data-testid="scim-issue"
          onClick={() => {
            setFirst(!rotate);
            open();
          }}
          className="oi-hover"
          style={rowButtonStyle()}
        >
          {rotate ? t("settingsV2.scim.rotate") : t("settingsV2.scim.issue")}
        </button>
      )}
    />
  );
}
