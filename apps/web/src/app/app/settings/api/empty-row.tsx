import type { ReactNode } from "react";

/** The one line a list card shows when it has no rows yet — in the row's place, on its rule. */
export function EmptyRow({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      style={{
        padding: "12px 18px",
        borderTop: "1px solid var(--line-2)",
        fontSize: 12.5,
        color: "var(--ink-3)",
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
