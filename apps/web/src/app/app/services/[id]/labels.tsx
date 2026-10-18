"use client";

/**
 * The service's labels, and "+ label" — typed the way they read, `key:value`.
 * A label is removed from its own chip (the cross shows on hover), so the
 * row stays the design's quiet line of chips until someone reaches for it.
 */

import { useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import { orderedLabels } from "../words";
import { removeLabel, setLabel } from "../actions";

const CHIP: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 11,
  background: "var(--sunk)",
  borderRadius: 5,
  padding: "2px 7px",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

export function Labels({
  serviceId,
  labels,
  mayEdit,
}: {
  serviceId: string;
  labels: Record<string, string>;
  mayEdit: boolean;
}) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [pending, start] = useTransition();

  const submit = () => {
    const fd = new FormData();
    fd.set("serviceId", serviceId);
    fd.set("label", value);
    start(async () => {
      const res = await setLabel(fd);
      if (res.ok) {
        setValue("");
        setAdding(false);
        setInvalid(false);
      } else setInvalid(true);
    });
  };
  const remove = (key: string) => {
    const fd = new FormData();
    fd.set("serviceId", serviceId);
    fd.set("key", key);
    start(() => removeLabel(fd));
  };

  return (
    <div
      data-testid="service-labels"
      style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}
    >
      <style>{`.si-chip .si-x{display:none}.si-chip:hover .si-x{display:inline}`}</style>
      {orderedLabels(labels).map(([k, v]) => (
        <span key={k} className="si-chip" style={CHIP} data-testid="service-label">
          {`${k}:${v}`}
          {mayEdit && (
            <button
              type="button"
              className="si-x"
              aria-label={t("services.removeLabel", { label: `${k}:${v}` })}
              onClick={() => remove(k)}
              disabled={pending}
              style={{
                border: 0,
                background: "none",
                padding: 0,
                fontSize: 10,
                color: "var(--ink-3)",
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}
        </span>
      ))}
      {mayEdit && !adding && (
        <button
          type="button"
          data-testid="label-add"
          onClick={() => setAdding(true)}
          style={{
            fontSize: 11,
            color: "var(--brand)",
            fontWeight: 600,
            cursor: "pointer",
            padding: "2px 4px",
            border: 0,
            background: "none",
          }}
        >
          {t("services.addLabel")}
        </button>
      )}
      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <input
            autoFocus
            name="label"
            data-testid="label-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setInvalid(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setAdding(false);
                setValue("");
              }
            }}
            onBlur={() => {
              if (!value.trim()) setAdding(false);
            }}
            placeholder="key:value"
            className="oi-field"
            style={{
              height: 22,
              width: 170,
              border: `1px solid ${invalid ? "var(--dang)" : "var(--line)"}`,
              borderRadius: 5,
              padding: "0 7px",
              fontFamily: "var(--mono)",
              fontSize: 11,
              background: "var(--panel)",
              color: "var(--ink)",
              outline: "none",
            }}
          />
          {invalid && (
            <span style={{ fontSize: 11, color: "var(--dang)" }}>{t("services.labelInvalid")}</span>
          )}
        </form>
      )}
    </div>
  );
}
