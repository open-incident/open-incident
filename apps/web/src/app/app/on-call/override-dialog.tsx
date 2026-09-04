"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { createOverride } from "./actions";

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
const control: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  border: "1px solid var(--line)",
  borderRadius: 10,
  outline: "none",
  fontSize: 13,
  background: "var(--panel)",
  width: "100%",
};

/** "Add an override": rotation, who (or nobody), from, to. Local times are the browser's; the server stores instants. */
export function OverrideDialog({
  scheduleId,
  rotations,
  members,
}: {
  scheduleId: string;
  rotations: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const iso = (local: string) => (local ? new Date(local).toISOString() : "");
  return (
    <>
      <button
        type="button"
        data-testid="override-open"
        onClick={() => setOpen(true)}
        className="oi-hover"
        style={{
          height: 34,
          padding: "0 13px",
          border: "1px solid var(--line)",
          borderRadius: 9,
          background: "var(--panel)",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        {t("oncall.addOverride")}
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim-dialog)",
            display: "grid",
            placeItems: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <form
            data-testid="override-form"
            action={createOverride}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            className="oi-rise"
            style={{
              width: 500,
              maxWidth: "100%",
              background: "var(--panel)",
              borderRadius: 18,
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div style={{ fontFamily: "var(--font-title)", fontSize: 16.5, fontWeight: 600 }}>
                {t("oncall.addOverrideTitle")}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
                className="oi-hover"
                style={{
                  marginLeft: "auto",
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: 0,
                  background: "transparent",
                  color: "var(--ink-3)",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                ✕
              </button>
            </div>
            <div
              style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 13 }}
            >
              <input type="hidden" name="scheduleId" value={scheduleId} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("oncall.rotation")}</span>
                  <select
                    name="rotationId"
                    defaultValue={rotations[0]?.id ?? ""}
                    className="oi-field"
                    style={control}
                  >
                    {rotations.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("oncall.who")}</span>
                  <select
                    name="memberId"
                    defaultValue={members[0]?.id ?? ""}
                    className="oi-field"
                    style={control}
                  >
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                    <option value="">{t("oncall.nobody")}</option>
                  </select>
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("oncall.from")}</span>
                  <input
                    type="datetime-local"
                    required
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="oi-field"
                    style={control}
                  />
                  <input type="hidden" name="startAt" value={iso(start)} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("oncall.to")}</span>
                  <input
                    type="datetime-local"
                    required
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="oi-field"
                    style={control}
                  />
                  <input type="hidden" name="endAt" value={iso(end)} />
                </label>
              </div>
              <div
                style={{
                  background: "var(--sunk)",
                  borderRadius: 11,
                  padding: "11px 13px",
                  fontSize: 12,
                  color: "var(--ink-2)",
                  lineHeight: 1.5,
                }}
              >
                {t("oncall.overrideNote")}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "14px 20px",
                borderTop: "1px solid var(--line)",
              }}
            >
              <span style={{ flex: 1 }} />
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
                {t("common.cancel")}
              </button>
              <button
                type="submit"
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
                  whiteSpace: "nowrap",
                }}
              >
                {t("common.create")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
