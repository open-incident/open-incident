"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { addNode, createPath } from "./actions";

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
const KINDS = ["level", "condition", "delay", "retry", "reassign"] as const;

type Labels = {
  schedules: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
  workingHours: Array<{ id: string; name: string }>;
  paths: Array<{ id: string; name: string }>;
  levels: Array<{ id: string }>;
};

/** "+ Add a node": the kind as pills, then the fields of that kind. Lands on the draft; publish to create the next version. */
export function AddNodeDialog({ pathId, labels }: { pathId: string; labels: Labels }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("level");
  return (
    <>
      <button
        type="button"
        data-testid="node-add-open"
        onClick={() => setOpen(true)}
        className="oi-hover"
        style={{
          width: 280,
          border: "1.5px dashed var(--line)",
          borderRadius: 10,
          padding: "8px 14px",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--ink-3)",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {t("oncall.addNode")}
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
            data-testid="node-form"
            action={addNode}
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
            <input type="hidden" name="pathId" value={pathId} />
            <input type="hidden" name="kind" value={kind} />
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
                {t("oncall.addNodeTitle")}
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
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    style={{
                      height: 30,
                      padding: "0 13px",
                      border: `1px solid ${kind === k ? "var(--brand)" : "var(--line)"}`,
                      borderRadius: 999,
                      background: kind === k ? "var(--brand)" : "var(--panel)",
                      color: kind === k ? "#fff" : "var(--ink-2)",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {t(`oncall.nodeKind.${k}`)}
                  </button>
                ))}
              </div>
              {kind === "level" && (
                <>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={label}>{t("oncall.target")}</span>
                    <select
                      name="target"
                      className="oi-field"
                      style={control}
                      defaultValue={
                        labels.schedules[0]
                          ? `schedule:${labels.schedules[0].id}:current`
                          : labels.members[0]
                            ? `member:${labels.members[0].id}`
                            : ""
                      }
                    >
                      <optgroup label={t("oncall.schedules")}>
                        {labels.schedules.flatMap((s) =>
                          (["current", "next", "everyone"] as const).map((mode) => (
                            <option key={`${s.id}:${mode}`} value={`schedule:${s.id}:${mode}`}>
                              {s.name} — {t(`oncall.mode.${mode}`)}
                            </option>
                          )),
                        )}
                      </optgroup>
                      <optgroup label={t("oncall.members")}>
                        {labels.members.map((m) => (
                          <option key={m.id} value={`member:${m.id}`}>
                            {m.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("oncall.ackTimeout")}</span>
                      <select
                        name="ackTimeoutMinutes"
                        defaultValue="20"
                        className="oi-field"
                        style={control}
                      >
                        {[2, 5, 10, 15, 20, 30, 60].map((m) => (
                          <option key={m} value={m}>
                            {m} min
                          </option>
                        ))}
                      </select>
                    </label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={label}>{t("oncall.urgency")}</span>
                      <div
                        style={{
                          display: "flex",
                          gap: 2,
                          background: "var(--sunk)",
                          borderRadius: 9,
                          padding: 3,
                        }}
                      >
                        {(["high", "low"] as const).map((u) => (
                          <label
                            key={u}
                            style={{
                              flex: 1,
                              padding: "6px 0",
                              borderRadius: 7,
                              textAlign: "center",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                              color: "var(--ink-2)",
                            }}
                          >
                            <input
                              type="radio"
                              name="urgency"
                              value={u}
                              defaultChecked={u === "high"}
                            />{" "}
                            {u === "high" ? t("oncall.urgencyHigh") : t("oncall.urgencyLow")}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <input type="hidden" name="retries" value="0" />
                  <input type="hidden" name="retryIntervalMinutes" value="2" />
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: 12.5,
                      color: "var(--ink-2)",
                    }}
                  >
                    <input type="checkbox" name="everyoneMustAck" /> {t("oncall.everyoneMustAck")}
                  </label>
                </>
              )}
              {kind === "condition" && (
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("oncall.condition")}</span>
                  <select
                    name="test"
                    className="oi-field"
                    style={control}
                    defaultValue={
                      labels.workingHours[0]
                        ? `working_hours:${labels.workingHours[0].id}`
                        : "priority:1"
                    }
                  >
                    {labels.workingHours.map((w) => (
                      <option key={w.id} value={`working_hours:${w.id}`}>
                        {t("oncall.condHours", { set: w.name })}
                      </option>
                    ))}
                    <option value="priority:0">{t("oncall.condPriority", { rank: 1 })}</option>
                    <option value="priority:1">{t("oncall.condPriority", { rank: 2 })}</option>
                    <option value="urgency:high">
                      {t("oncall.condUrgency", { urgency: "high" })}
                    </option>
                  </select>
                </label>
              )}
              {kind === "delay" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={label}>{t("oncall.delayMinutesLabel")}</span>
                    <input
                      name="minutes"
                      type="number"
                      min={1}
                      max={1440}
                      defaultValue={15}
                      className="oi-field"
                      style={control}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={label}>{t("oncall.delayUntilLabel")}</span>
                    <select
                      name="untilWorkingHoursSetId"
                      defaultValue=""
                      className="oi-field"
                      style={control}
                    >
                      <option value="">{t("oncall.fixedDelay")}</option>
                      {labels.workingHours.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {kind === "retry" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={label}>{t("oncall.retryBackTo")}</span>
                    <select name="toNodeId" className="oi-field" style={control}>
                      {labels.levels.map((l, i) => (
                        <option key={l.id} value={l.id}>
                          {t("oncall.levelTag")} {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={label}>{t("oncall.maxLoops")}</span>
                    <input
                      name="maxLoops"
                      type="number"
                      min={1}
                      max={10}
                      defaultValue={2}
                      className="oi-field"
                      style={control}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={label}>{t("oncall.intervalMinutes")}</span>
                    <input
                      name="intervalMinutes"
                      type="number"
                      min={1}
                      max={120}
                      defaultValue={5}
                      className="oi-field"
                      style={control}
                    />
                  </label>
                </div>
              )}
              {kind === "reassign" && (
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={label}>{t("oncall.reassignPath")}</span>
                  <select name="toPathId" className="oi-field" style={control}>
                    {labels.paths.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
                {t("oncall.addNodeNote")}
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
                disabled={kind === "reassign" && labels.paths.length === 0}
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
                {t("oncall.addNodeSubmit")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export function NewPathDialog() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="path-new"
        onClick={() => setOpen(true)}
        className="oi-hover"
        style={{
          height: 30,
          padding: "0 12px",
          border: "1.5px dashed var(--line)",
          borderRadius: 999,
          background: "transparent",
          color: "var(--ink-3)",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("oncall.newPath")}
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
            action={createPath}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            className="oi-rise"
            style={{
              width: 440,
              maxWidth: "100%",
              background: "var(--panel)",
              borderRadius: 18,
              boxShadow: "var(--shadow-modal)",
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 13,
            }}
          >
            <div style={{ fontFamily: "var(--font-title)", fontSize: 16.5, fontWeight: 600 }}>
              {t("oncall.newPathTitle")}
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>{t("oncall.name")}</span>
              <input
                name="name"
                required
                autoFocus
                minLength={2}
                maxLength={80}
                placeholder="Storefront escalation"
                className="oi-field"
                style={control}
              />
            </label>
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
              {t("oncall.newPathNote")}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
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
