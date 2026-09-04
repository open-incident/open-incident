"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { avatarTone, initials } from "@/lib/avatar";
import { escalateIncident, previewEscalation } from "./escalate-actions";

type Level = {
  level: number;
  offsetMinutes: number;
  members: string[];
  urgency: string;
  ackTimeoutMinutes: number;
  retries: number;
};

/** "Escalate INC-n": pick a path, see who will be paged and when, confirm. */
export function EscalateDialog({
  number,
  paths,
}: {
  number: number;
  paths: Array<{ id: string; name: string; levels: number }>;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pathId, setPathId] = useState(paths[0]?.id ?? "");
  const [preview, setPreview] = useState<Level[] | null>(null);
  const [pending, start] = useTransition();
  const [done, setDone] = useState<null | boolean>(null);
  useEffect(() => {
    if (!open || !pathId) return;
    setPreview(null);
    let alive = true;
    previewEscalation(pathId)
      .then((p) => alive && setPreview(p))
      .catch(() => alive && setPreview([]));
    return () => {
      alive = false;
    };
  }, [open, pathId]);
  if (paths.length === 0) return null;
  const confirm = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("number", String(number));
      fd.set("pathId", pathId);
      const r = await escalateIncident(fd);
      setDone(r.ok);
      if (r.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  return (
    <>
      <button
        type="button"
        data-testid="escalate-open"
        onClick={() => setOpen(true)}
        className="oi-hover"
        style={{
          height: 36,
          padding: "0 14px",
          border: "1px solid var(--line)",
          borderRadius: 9,
          background: "var(--panel)",
          display: "flex",
          alignItems: "center",
          fontSize: 13.5,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        {t("incident.escalate")}
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(8,12,14,.45)",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            paddingTop: "10vh",
            zIndex: 60,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            className="oi-rise"
            style={{
              width: 500,
              maxWidth: "94vw",
              background: "var(--panel)",
              borderRadius: 18,
              boxShadow: "var(--shadow-modal)",
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
              <span style={{ fontFamily: "var(--font-title)", fontSize: 17, fontWeight: 600 }}>
                {t("incident.escalateTitle", { number: `INC-${number}` })}
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
                  border: 0,
                  background: "transparent",
                  color: "var(--ink-3)",
                  fontSize: 15,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
            <div
              style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 13 }}
            >
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--ink-2)",
                }}
              >
                {t("incident.escalatePath")}
                <select
                  value={pathId}
                  onChange={(e) => setPathId(e.target.value)}
                  className="oi-field"
                  style={{
                    height: 40,
                    padding: "0 12px",
                    border: "1px solid var(--line)",
                    borderRadius: 9,
                    fontSize: 13.5,
                    background: "var(--panel)",
                  }}
                >
                  {paths.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {t("incident.escalateLevels", { count: p.levels })}
                    </option>
                  ))}
                </select>
              </label>
              <div
                data-testid="escalate-preview"
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  padding: "13px 15px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 11,
                }}
              >
                <div className="oi-eyebrow">{t("incident.whoWillBePaged")}</div>
                {preview === null && <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>…</div>}
                {preview?.length === 0 && (
                  <div style={{ fontSize: 12.5, color: "var(--dang)" }}>
                    {t("incident.escalateNobody")}
                  </div>
                )}
                {preview?.map((l) => {
                  const first = l.members[0] ?? "—";
                  const tone = avatarTone(first);
                  return (
                    <div
                      key={l.level}
                      style={{ display: "flex", gap: 10, alignItems: "flex-start" }}
                    >
                      <span
                        style={{
                          width: 26,
                          height: 26,
                          flex: "none",
                          borderRadius: "50%",
                          background: tone.bg,
                          color: tone.ink,
                          display: "grid",
                          placeItems: "center",
                          fontSize: 9.5,
                          fontWeight: 700,
                        }}
                      >
                        {l.members.length ? initials(first) : "—"}
                      </span>
                      <div style={{ flex: 1, lineHeight: 1.3, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {l.members.join(", ") || t("oncall.nobody")}
                          {l.level === 1 && l.members.length > 0 && (
                            <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>
                              {" "}
                              · {t("incident.onCallNow")}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                          {t("incident.escalateLevelLine", {
                            level: l.level,
                            urgency:
                              l.urgency === "high"
                                ? t("oncall.urgencyHigh")
                                : t("oncall.urgencyLow"),
                            ack: l.ackTimeoutMinutes,
                            retries: l.retries,
                          })}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: l.offsetMinutes === 0 ? 700 : 600,
                          color: l.offsetMinutes === 0 ? "var(--dang)" : "var(--ink-3)",
                        }}
                      >
                        {l.offsetMinutes === 0 ? t("incident.now") : `+${l.offsetMinutes} min`}
                      </span>
                    </div>
                  );
                })}
              </div>
              {done === false && (
                <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
                  {t("incident.escalateFailed")}
                </div>
              )}
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("incident.escalateNote")}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                padding: "14px 22px",
                borderTop: "1px solid var(--line)",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="oi-hover"
                style={{
                  height: 36,
                  padding: "0 14px",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  background: "var(--panel)",
                  fontSize: 13.5,
                  cursor: "pointer",
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                data-testid="escalate-confirm"
                onClick={confirm}
                disabled={pending || !preview || preview.length === 0}
                style={{
                  height: 36,
                  padding: "0 16px",
                  borderRadius: 9,
                  background: "var(--brand)",
                  color: "#fff",
                  border: 0,
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("incident.escalateConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
