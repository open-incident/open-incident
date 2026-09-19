"use client";

/**
 * A team, created or renamed in one dialog.
 *
 * The same shape for both because the fields are the same three, and a team is
 * small enough that a second screen for editing would be a second screen for
 * nothing. The policy is optional and the list says what a team without one
 * costs; forcing a choice here would only mean picking the wrong path to get
 * past the form.
 */

import { useState } from "react";
import { useT } from "@/i18n/client";
import { createTeam, updateTeam } from "./actions";

type Named = { id: string; name: string };

const CONTROL: React.CSSProperties = {
  height: 38,
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "0 12px",
  fontSize: 13.5,
  outline: "none",
  background: "var(--panel)",
  width: "100%",
};

const LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

const FIELD: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5 };

export function TeamDialog({
  paths,
  members,
  team,
}: {
  paths: Named[];
  members: Named[];
  /** Absent for "+ New team"; present to rename one. */
  team?: { id: string; name: string; policyPathId: string | null; chatChannel: string | null };
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const editing = Boolean(team);

  return (
    <>
      {editing ? (
        <button
          type="button"
          data-testid="team-edit"
          onClick={() => setOpen(true)}
          aria-label={t("common.edit")}
          title={t("common.edit")}
          className="oi-hover"
          style={{
            width: 26,
            height: 26,
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--panel)",
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            cursor: "pointer",
            color: "inherit",
          }}
        >
          ✎
        </button>
      ) : (
        <button
          type="button"
          data-testid="team-new"
          onClick={() => setOpen(true)}
          className="oi-hover-brand-2"
          style={{
            height: 30,
            padding: "0 13px",
            borderRadius: 9,
            background: "var(--brand)",
            color: "var(--on-brand)",
            border: 0,
            display: "flex",
            alignItems: "center",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {t("oc2.teams.new")}
        </button>
      )}

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "10vh",
            zIndex: 50,
          }}
        >
          <form
            action={editing ? updateTeam : createTeam}
            onClick={(e) => e.stopPropagation()}
            className="oi-rise-fast"
            role="dialog"
            aria-modal="true"
            data-testid="team-form"
            style={{
              width: 520,
              maxWidth: "calc(100vw - 32px)",
              background: "var(--panel)",
              borderRadius: "var(--radius-modal)",
              boxShadow: "var(--shadow-modal)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "16px 22px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{ fontFamily: "var(--title)", fontSize: 17, fontWeight: 600 }}>
                {editing ? t("oc2.teams.editTitle") : t("oc2.teams.newTitle")}
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--ink-3)",
                  cursor: "pointer",
                  border: 0,
                  background: "none",
                }}
              >
                ✕
              </button>
            </div>

            <div
              style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}
            >
              {team && <input type="hidden" name="id" value={team.id} />}
              <label style={FIELD}>
                <span style={LABEL}>{t("oc2.teams.name")}</span>
                <input
                  name="name"
                  required
                  autoFocus
                  minLength={2}
                  maxLength={80}
                  defaultValue={team?.name ?? ""}
                  placeholder="Payments"
                  style={CONTROL}
                />
              </label>

              <label style={FIELD}>
                <span style={LABEL}>
                  {t("oc2.teams.policy")} · {t("common.optional")}
                </span>
                <select
                  name="policyPathId"
                  defaultValue={team?.policyPathId ?? ""}
                  style={{ ...CONTROL, padding: "0 9px", fontSize: 13 }}
                >
                  <option value="">{t("oc2.teams.noPathOption")}</option>
                  {paths.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
                  {t("oc2.teams.policyHint")}
                </span>
              </label>

              <label style={FIELD}>
                <span style={LABEL}>
                  {t("oc2.teams.channel")} · {t("common.optional")}
                </span>
                <input
                  name="chatChannel"
                  maxLength={120}
                  defaultValue={team?.chatChannel ?? ""}
                  placeholder="#payments-oncall"
                  style={{ ...CONTROL, fontFamily: "var(--mono)", fontSize: 12.5 }}
                />
              </label>

              {!editing && members.length > 0 && (
                <div style={FIELD}>
                  <span style={LABEL}>
                    {t("oc2.teams.members")} · {t("common.optional")}
                  </span>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      maxHeight: 132,
                      overflowY: "auto",
                    }}
                  >
                    {members.map((m) => (
                      <label
                        key={m.id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          height: 30,
                          padding: "0 10px",
                          border: "1px solid var(--line)",
                          borderRadius: 999,
                          fontSize: 12.5,
                          cursor: "pointer",
                        }}
                      >
                        <input type="checkbox" name="members" value={m.id} />
                        {m.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                padding: "13px 22px",
                background: "var(--sunk)",
                borderTop: "1px solid var(--line)",
              }}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="oi-hover"
                style={{
                  height: 34,
                  padding: "0 14px",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  background: "var(--panel)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "inherit",
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className="oi-hover-brand-2"
                style={{
                  height: 34,
                  padding: "0 16px",
                  border: 0,
                  borderRadius: 9,
                  background: "var(--brand)",
                  color: "var(--on-brand)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {editing ? t("common.save") : t("oc2.teams.create")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
