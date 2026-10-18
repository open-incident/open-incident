"use client";

import { useTransition } from "react";
import { useT } from "@/i18n/client";
import { flash } from "@/components/settings/controls";
import { itemButtonStyle } from "@/components/settings/template";
import { removeSso } from "./actions";

/** "Remove" on a connection row — done, or refused with the reason in the toast. */
export function RemoveConnection({ id }: { id: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      data-testid="sso-remove"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set("id", id);
          const res = await removeSso(fd);
          flash(res.ok ? res.message : res.error);
        })
      }
      className="oi-hover-dang"
      style={{ ...itemButtonStyle("dang"), opacity: pending ? 0.6 : 1 }}
    >
      {t("settingsV2.sso.remove")}
    </button>
  );
}
