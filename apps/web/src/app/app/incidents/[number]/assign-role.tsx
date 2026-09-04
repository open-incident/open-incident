"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { assignRole, listAssignableMembers } from "./actions";

type Role = { roleId: string; roleName: string; memberId: string | null };

/** "Assigner" — a small inline form: pick the role, pick the member, assign. */
export function AssignRole({ number, roles }: { number: number; roles: Role[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (open)
      listAssignableMembers()
        .then(setPeople)
        .catch(() => setPeople([]));
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="oi-link"
        style={{ fontSize: 12, fontWeight: 600, background: "transparent", border: 0, padding: 0 }}
      >
        {t("incident.assign")}
      </button>
    );
  }
  const control: React.CSSProperties = {
    height: 30,
    padding: "0 9px",
    border: "1px solid var(--line)",
    borderRadius: 8,
    fontSize: 12.5,
    background: "var(--panel)",
    outline: "none",
    width: "100%",
  };
  return (
    <form
      action={async (fd) => {
        await assignRole(fd);
        setOpen(false);
      }}
      style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}
    >
      <input type="hidden" name="number" value={number} />
      <select
        name="roleId"
        defaultValue={roles.find((r) => !r.memberId)?.roleId ?? roles[0]?.roleId}
        className="oi-field"
        style={control}
        aria-label={t("incident.assignRole")}
      >
        {roles.map((r) => (
          <option key={r.roleId} value={r.roleId}>
            {r.roleName}
          </option>
        ))}
      </select>
      <select
        name="memberId"
        required
        className="oi-field"
        style={control}
        aria-label={t("incident.assignMember")}
      >
        <option value="">—</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="submit"
          style={{
            flex: 1,
            height: 28,
            borderRadius: 7,
            background: "var(--brand)",
            color: "#fff",
            border: 0,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {t("incident.assign")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            height: 28,
            padding: "0 10px",
            borderRadius: 7,
            border: "1px solid var(--line)",
            background: "var(--panel)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
