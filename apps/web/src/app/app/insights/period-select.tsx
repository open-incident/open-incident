"use client";

import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";

/** The period select: 30, 90 or 365 days — a navigation, nothing more. */
export function PeriodSelect({
  days,
  tab,
  compare,
}: {
  days: number;
  tab: string;
  compare: boolean;
}) {
  const t = useT();
  const router = useRouter();
  return (
    <select
      aria-label={t("insights.period")}
      value={String(days)}
      onChange={(e) =>
        router.push(`/app/insights?tab=${tab}&days=${e.target.value}&compare=${compare ? 1 : 0}`)
      }
      className="oi-field"
      style={{
        height: 34,
        padding: "0 13px",
        border: "1px solid var(--line)",
        borderRadius: 9,
        background: "var(--panel)",
        fontSize: 13,
        color: "var(--ink-2)",
        cursor: "pointer",
      }}
    >
      {[30, 90, 365].map((d) => (
        <option key={d} value={d}>
          {t("insights.lastDays", { count: d })}
        </option>
      ))}
    </select>
  );
}
