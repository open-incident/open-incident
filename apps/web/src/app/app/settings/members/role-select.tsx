"use client";

/**
 * The role of a member, saved the moment it changes.
 *
 * The row used to carry a select and an "Apply" button beside it — thirty
 * members, thirty buttons, and the guide already promised that the select
 * saves on change. It does now: the select submits the form around it, which
 * is the server action that always saved it.
 */
export function RoleSelect({
  name,
  defaultValue,
  options,
  label,
}: {
  name: string;
  defaultValue: string;
  options: Array<{ value: string; label: string }>;
  label: string;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      aria-label={label}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="oi-field"
      style={{
        height: 30,
        padding: "0 11px",
        border: "1px solid var(--line)",
        borderRadius: 8,
        fontSize: 12.5,
        background: "var(--panel)",
        minWidth: 128,
        outline: "none",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
