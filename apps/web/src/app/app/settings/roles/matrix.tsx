"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { useT } from "@/i18n/client";
import { SettingsForm } from "@/components/settings/settings-form";
import { CardFoot, cardStyle, filterChipStyle } from "@/components/settings/template";
import { saveRolePermissions } from "./actions";
import { DeleteRoleButton, EditRoleDialog } from "./role-dialogs";

type RoleChip = {
  id: string;
  name: string;
  description: string;
  base: "admin" | "responder" | "viewer";
  members: string;
};

/**
 * The permission matrix of the design: the built-in roles in grey,
 * read-only; the selected custom role in brand, a box per permission. Each
 * box is a real checkbox named `permissions`, so the save bar sees a click
 * like any other change and posts the whole column.
 */
export function RoleMatrix({
  roles,
  selected,
  builtIn,
  permissions,
  hint,
  manages,
}: {
  roles: RoleChip[];
  selected: { id: string; name: string; permissions: string[] } | null;
  builtIn: Array<{ key: string; label: string; permissions: string[] }>;
  permissions: Array<{ key: string; label: string }>;
  hint: string;
  manages: boolean;
}) {
  const t = useT();
  const cols = builtIn.length + (selected ? 1 : 0);
  const grid = `minmax(260px,1fr) repeat(${cols},96px)`;
  const current = roles.find((r) => r.id === selected?.id);

  const card = (
    <section data-testid="roles-matrix" style={cardStyle}>
      <div style={{ padding: "13px 18px 10px" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t("settingsV2.roles.matrix")}</div>
        <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>{hint}</div>
      </div>
      {roles.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            alignItems: "center",
            padding: "0 18px 12px",
          }}
        >
          {roles.map((r) => {
            const on = r.id === selected?.id;
            return (
              <Link
                key={r.id}
                href={`/app/settings/roles?role=${r.id}`}
                scroll={false}
                data-testid="role-chip"
                data-role={r.name}
                aria-current={on ? "true" : undefined}
                style={filterChipStyle(on)}
              >
                {r.name}
                <span
                  data-testid="role-members"
                  style={{ fontSize: 11, fontWeight: 500, opacity: 0.75 }}
                >
                  {r.members}
                </span>
              </Link>
            );
          })}
          <span style={{ flex: 1 }} />
          {manages && current && (
            <>
              <EditRoleDialog role={current} />
              <DeleteRoleButton id={current.id} />
            </>
          )}
        </div>
      )}
      {selected && <input type="hidden" name="id" value={selected.id} />}
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 260 + cols * 96 + 36 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: grid,
              padding: "8px 18px",
              borderTop: "1px solid var(--line)",
              background: "var(--sunk)",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            <span>{t("settingsV2.roles.col.permission")}</span>
            {builtIn.map((b) => (
              <span key={b.key} style={colHead("var(--ink-3)")}>
                {b.label}
              </span>
            ))}
            {selected && (
              <span style={colHead("var(--brand)")} title={selected.name}>
                {selected.name}
              </span>
            )}
          </div>
          {permissions.map((p) => (
            <div
              key={p.key}
              data-permission={p.key}
              style={{
                display: "grid",
                gridTemplateColumns: grid,
                alignItems: "center",
                padding: "9px 18px",
                borderTop: "1px solid var(--line-2)",
              }}
            >
              <span style={{ fontSize: 13, lineHeight: 1.4 }}>{p.label}</span>
              {builtIn.map((b) => {
                const on = b.permissions.includes(p.key);
                return (
                  <span key={b.key} style={{ display: "flex", justifyContent: "center" }}>
                    <span
                      aria-label={`${b.label} · ${p.label}`}
                      role="img"
                      style={box({
                        on,
                        bg: on ? "var(--ink-3)" : "transparent",
                        border: on ? "1px solid var(--ink-3)" : "1px solid var(--line)",
                        cursor: "default",
                      })}
                    >
                      {on ? "✓" : ""}
                    </span>
                  </span>
                );
              })}
              {selected && (
                <Cell
                  name={selected.name}
                  label={p.label}
                  permission={p.key}
                  initial={selected.permissions.includes(p.key)}
                  disabled={!manages}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <CardFoot>{t("settingsV2.roles.foot")}</CardFoot>
    </section>
  );

  if (!selected || !manages) return card;
  return (
    <SettingsForm action={saveRolePermissions} testId="role-form">
      {card}
    </SettingsForm>
  );
}

function Cell({
  name,
  label,
  permission,
  initial,
  disabled,
}: {
  name: string;
  label: string;
  permission: string;
  initial: boolean;
  disabled: boolean;
}) {
  const [on, setOn] = useState(initial);
  return (
    <span style={{ display: "flex", justifyContent: "center" }}>
      <label style={{ display: "inline-flex", cursor: disabled ? "default" : "pointer" }}>
        <input
          type="checkbox"
          name="permissions"
          value={permission}
          defaultChecked={initial}
          disabled={disabled}
          aria-label={`${name} · ${label}`}
          data-testid="role-cell"
          onChange={(e) => setOn(e.currentTarget.checked)}
          style={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none" }}
        />
        <span
          aria-hidden
          style={box({
            on,
            bg: on ? "var(--brand)" : "var(--panel)",
            border: on ? "1px solid var(--brand)" : "1.5px solid var(--brand-b)",
            cursor: disabled ? "default" : "pointer",
          })}
        >
          {on ? "✓" : ""}
        </span>
      </label>
    </span>
  );
}

function colHead(ink: string): CSSProperties {
  return {
    textAlign: "center",
    color: ink,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}

function box({
  bg,
  border,
  cursor,
}: {
  on: boolean;
  bg: string;
  border: string;
  cursor: string;
}): CSSProperties {
  return {
    width: 20,
    height: 20,
    borderRadius: 6,
    border,
    background: bg,
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontSize: 11,
    fontWeight: 800,
    cursor,
    boxSizing: "border-box",
  };
}
