"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { avatarTone, initials } from "@/lib/avatar";
import { createSchedule } from "./actions";

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

/** "+ New schedule": name, zone, handover, rotation kind, ordered members. Created as a draft. */
export function NewScheduleDialog({
  members,
  timezones,
  defaultTimezone,
}: {
  members: Array<{ id: string; name: string }>;
  timezones: string[];
  defaultTimezone: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [interval, setInterval_] = useState<"weekly" | "daily" | "weekend">("weekly");
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <>
      <button
        type="button"
        data-testid="schedule-open"
        onClick={() => setOpen(true)}
        className="oi-hover"
        style={{
          marginTop: 4,
          padding: "8px 10px",
          border: "1.5px dashed var(--line)",
          borderRadius: 9,
          fontSize: 12.5,
          color: "var(--ink-3)",
          background: "transparent",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        {t("oncall.newSchedule")}
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
            data-testid="schedule-form"
            action={createSchedule}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            className="oi-rise"
            style={{
              width: 520,
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
                {t("oncall.newScheduleTitle")}
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
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("oncall.name")}</span>
                <input
                  name="name"
                  required
                  autoFocus
                  minLength={2}
                  maxLength={80}
                  placeholder="Storefront primary"
                  className="oi-field"
                  style={control}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("oncall.timezone")}</span>
                  <select
                    name="timezone"
                    defaultValue={defaultTimezone}
                    className="oi-field"
                    style={control}
                  >
                    {(timezones.includes(defaultTimezone)
                      ? timezones
                      : [defaultTimezone, ...timezones]
                    ).map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("oncall.handoverAt")}</span>
                  <select
                    name="handoverTime"
                    defaultValue="09:00"
                    className="oi-field"
                    style={control}
                  >
                    {[
                      "00:00",
                      "06:00",
                      "07:00",
                      "08:00",
                      "09:00",
                      "10:00",
                      "12:00",
                      "17:00",
                      "18:00",
                      "20:00",
                      "21:00",
                    ].map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("oncall.rotation")}</span>
                <div
                  role="radiogroup"
                  style={{
                    display: "flex",
                    gap: 2,
                    background: "var(--sunk)",
                    borderRadius: 9,
                    padding: 3,
                  }}
                >
                  {(["weekly", "daily", "weekend"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={interval === k}
                      onClick={() => setInterval_(k)}
                      style={{
                        flex: 1,
                        padding: "6px 0",
                        borderRadius: 7,
                        border: 0,
                        background: interval === k ? "var(--panel)" : "transparent",
                        fontSize: 12.5,
                        fontWeight: interval === k ? 600 : 500,
                        color: interval === k ? "var(--ink)" : "var(--ink-3)",
                        boxShadow: interval === k ? "var(--shadow-card)" : "none",
                        cursor: "pointer",
                      }}
                    >
                      {t(`oncall.interval.${k}`)}
                    </button>
                  ))}
                </div>
                <input type="hidden" name="interval" value={interval} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>{t("oncall.membersOrder")}</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {picked.map((id, i) => {
                    const m = members.find((x) => x.id === id)!;
                    const tone = avatarTone(m.name);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setPicked((p) => p.filter((x) => x !== id))}
                        title={t("common.delete")}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          background: "var(--sunk)",
                          border: 0,
                          borderRadius: 999,
                          padding: "4px 11px 4px 5px",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            background: tone.bg,
                            color: tone.ink,
                            display: "grid",
                            placeItems: "center",
                            fontWeight: 700,
                            fontSize: 8.5,
                          }}
                        >
                          {initials(m.name)}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>
                          {i + 1}. {m.name.split(" ")[0]}
                        </span>
                      </button>
                    );
                  })}
                  {members
                    .filter((m) => !picked.includes(m.id))
                    .map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPicked((p) => [...p, m.id])}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          padding: "4px 11px",
                          border: "1.5px dashed var(--line)",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--brand)",
                          background: "transparent",
                          cursor: "pointer",
                        }}
                      >
                        + {m.name.split(" ")[0]}
                      </button>
                    ))}
                </div>
                {picked.map((id) => (
                  <input key={id} type="hidden" name="members" value={id} />
                ))}
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
                {t("oncall.newScheduleNote")}
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
                {t("oncall.createSchedule")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
