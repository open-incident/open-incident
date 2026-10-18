"use client";

import { useT } from "@/i18n/client";
import { flash } from "@/components/settings/controls";
import { pageActionClass, pageActionStyle } from "@/components/settings/template";

/**
 * "Export CSV": a real download of the lines under the current filter. The
 * export belongs to the advanced audit log; without it the button says so
 * instead of downloading nothing.
 */
export function ExportButton({ href, entitled }: { href: string; entitled: boolean }) {
  const t = useT();
  if (!entitled)
    return (
      <button
        type="button"
        data-testid="audit-export"
        aria-disabled="true"
        onClick={() => flash(t("settingsV2.audit.exportLocked"))}
        className={pageActionClass()}
        style={{ ...pageActionStyle(), color: "var(--ink-3)" }}
      >
        {t("settingsV2.audit.export")}
      </button>
    );
  return (
    <a
      href={href}
      download
      data-testid="audit-export"
      onClick={() => flash(t("settingsV2.audit.exportStarted"))}
      className={pageActionClass()}
      style={pageActionStyle()}
    >
      {t("settingsV2.audit.export")}
    </a>
  );
}
