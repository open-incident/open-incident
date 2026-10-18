"use client";

import { useRef, useTransition } from "react";
import { setSeverity } from "./actions";

/**
 * The severity of the facts card, edited where it is read: the value is a
 * select drawn as the design's bold coloured text, and choosing another level
 * saves it at once (the timeline records the change).
 */
export function SeverityPicker({
  number,
  current,
  options,
  none,
  label,
  color,
}: {
  number: number;
  current: string;
  options: Array<{ id: string; label: string }>;
  none: string;
  label: string;
  color: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  return (
    <form
      ref={form}
      action={(fd) => start(() => setSeverity(fd))}
      style={{ display: "inline-flex", opacity: pending ? 0.6 : 1 }}
    >
      <input type="hidden" name="number" value={number} />
      <select
        name="severityId"
        defaultValue={current}
        aria-label={label}
        data-testid="severity-picker"
        onChange={() => form.current?.requestSubmit()}
        className="oi-hover"
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          border: 0,
          background: "transparent",
          font: "inherit",
          fontWeight: 600,
          fontSize: 12.5,
          color,
          textAlign: "right",
          textAlignLast: "right",
          padding: 0,
          margin: 0,
          cursor: "pointer",
          borderRadius: 4,
        }}
      >
        {!current && <option value="">{none}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}
