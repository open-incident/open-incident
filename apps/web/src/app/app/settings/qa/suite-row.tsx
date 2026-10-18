"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { flash } from "@/components/settings/controls";
import { itemButtonStyle, type ChipSpec } from "@/components/settings/template";
import { ClickRow } from "../api/click-row";
import { runQaSuite } from "./actions";

/**
 * One suite: its last run in a sentence, the state chip, Run. The row opens
 * the last run (its log, what failed); Run queues a new one — absent while
 * one is queued or running, since a suite never runs twice at once.
 */
export function SuiteRow({
  suite,
  name,
  dot,
  sub,
  chip,
  lastId,
  canRun,
}: {
  suite: string;
  name: string;
  dot: string;
  sub: string;
  chip: ChipSpec | null;
  lastId: string | null;
  canRun: boolean;
}) {
  const t = useT();
  const router = useRouter();
  return (
    <ClickRow
      testId={`qa-suite-${suite}`}
      dot={dot}
      title={name}
      sub={sub}
      chips={chip ? [chip] : undefined}
      onOpen={lastId ? () => router.push(`/app/settings/qa/${lastId}`) : undefined}
      button={
        canRun ? (
          <form action={runQaSuite}>
            <input type="hidden" name="suite" value={suite} />
            <button
              type="submit"
              data-testid={`qa-run-${suite}`}
              className="oi-hover"
              style={itemButtonStyle("ink")}
            >
              {t("settingsV2.qa.run")}
            </button>
          </form>
        ) : undefined
      }
    />
  );
}

/** Says once, in the toast, what a redirect brought back (?queued=5), then drops it from the address. */
export function FlashOnce({ message }: { message: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const done = useRef(false);
  useEffect(() => {
    if (!message || done.current) return;
    done.current = true;
    flash(message);
    router.replace(pathname, { scroll: false });
  }, [message, pathname, router]);
  return null;
}
