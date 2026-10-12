"use client";

import { useRouter } from "next/navigation";

/**
 * Which type the sheet below is about. A select, not a list: a workspace with
 * thirty types — one per team, or a demo full of them — kept the sheet below
 * the fold behind a column of names.
 */
export function TypeSwitcher({
  current,
  types,
  label,
}: {
  current: string;
  types: Array<{ id: string; name: string; count: number; isDefault: boolean }>;
  label: string;
}) {
  const router = useRouter();
  return (
    <select
      aria-label={label}
      data-testid="type-switcher"
      value={current}
      onChange={(e) => router.push(`/app/settings/types?type=${e.currentTarget.value}`)}
      className="oi-field"
      style={{
        height: 36,
        padding: "0 11px",
        border: "1px solid var(--line)",
        borderRadius: 9,
        fontSize: 13.5,
        fontWeight: 600,
        background: "var(--panel)",
        minWidth: 260,
        outline: "none",
      }}
    >
      {types.map((ty) => (
        <option key={ty.id} value={ty.id}>
          {ty.isDefault ? "★ " : ""}
          {ty.name} · {ty.count}
        </option>
      ))}
    </select>
  );
}
