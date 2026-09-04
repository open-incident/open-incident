"use client";

import { useState } from "react";
import { PERMISSIONS, type Permission } from "@openincident/config";

type Labels = {
  title: string;
  name: string;
  description: string;
  base: string;
  baseHint: string;
  permissions: string;
  save: string;
  add: string;
  cancel: string;
  edit: string;
  remove: string;
  baseRoles: { admin: string; responder: string; viewer: string };
  permissionLabels: Record<Permission, string>;
};

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
const control: React.CSSProperties = {
  height: 36,
  padding: "0 12px",
  border: "1px solid var(--line)",
  borderRadius: 10,
  outline: "none",
  fontSize: 13,
  background: "var(--panel)",
  width: "100%",
};

/** Create or edit a custom role: name, base, and the permissions as checkboxes. */
export function RoleForm({
  mode,
  role,
  action,
  labels: l,
}: {
  mode: "create" | "edit";
  role?: { id: string; name: string; description: string; base: string; permissions: string[] };
  action: (formData: FormData) => Promise<void>;
  labels: Labels;
}) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        data-testid={mode === "create" ? "role-add" : "role-edit"}
        onClick={() => setOpen(true)}
        className={mode === "create" ? undefined : "oi-hover"}
        style={
          mode === "create"
            ? {
                alignSelf: "flex-start",
                height: 34,
                padding: "0 14px",
                borderRadius: 9,
                background: "var(--brand)",
                color: "#fff",
                border: 0,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }
            : {
                height: 28,
                padding: "0 10px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--panel)",
                fontSize: 12,
                cursor: "pointer",
              }
        }
      >
        {mode === "create" ? l.add : l.edit}
      </button>
    );
  return (
    <form
      action={action}
      data-testid="role-form"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: "16px 18px",
        width: "100%",
      }}
    >
      {role && <input type="hidden" name="id" value={role.id} />}
      <div style={{ fontFamily: "var(--font-title)", fontSize: 15.5, fontWeight: 600 }}>
        {mode === "create" ? l.title : role?.name}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>{l.name}</span>
          <input
            name="name"
            required
            defaultValue={role?.name ?? ""}
            placeholder="Alerting admin"
            className="oi-field"
            style={control}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>{l.base}</span>
          <select
            name="base"
            defaultValue={role?.base ?? "responder"}
            className="oi-field"
            style={control}
          >
            <option value="admin">{l.baseRoles.admin}</option>
            <option value="responder">{l.baseRoles.responder}</option>
            <option value="viewer">{l.baseRoles.viewer}</option>
          </select>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{l.baseHint}</span>
        </label>
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label}>{l.description}</span>
        <input
          name="description"
          defaultValue={role?.description ?? ""}
          className="oi-field"
          style={control}
        />
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label}>{l.permissions}</span>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 6,
          }}
        >
          {PERMISSIONS.map((p) => (
            <label key={p} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                name="permissions"
                value={p}
                defaultChecked={role?.permissions.includes(p) ?? false}
              />
              <span>{l.permissionLabels[p]}</span>
              <code
                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-3)" }}
              >
                {p}
              </code>
            </label>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          data-testid="role-save"
          style={{
            height: 34,
            padding: "0 16px",
            borderRadius: 9,
            background: "var(--brand)",
            color: "#fff",
            border: 0,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {l.save}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="oi-hover"
          style={{
            height: 34,
            padding: "0 13px",
            border: "1px solid var(--line)",
            borderRadius: 9,
            background: "var(--panel)",
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          {l.cancel}
        </button>
      </div>
    </form>
  );
}
