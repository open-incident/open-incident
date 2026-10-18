"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { showSetup } from "../onboarding-actions";

/** Shown only to a reader who put Home's three steps aside: brings them back, then goes there. */
export function ShowStepsButton() {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      data-testid="guide-show-steps"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await showSetup();
          router.push("/app");
        })
      }
      className="oi-btn"
      style={{ width: "fit-content" }}
    >
      {t("gd.showSteps")}
    </button>
  );
}
