"use client";

import { useState } from "react";
import type { AtlasNotifyMode } from "@openincident/db";
import { atlasNotifyMode } from "./actions";
import { useAtlasCommand } from "./toast";

/** The three choices, as radio cards; the choice is stored the moment it is made. */
export function NotifyChoice({
  mode,
  options,
}: {
  mode: AtlasNotifyMode;
  options: Array<{ id: AtlasNotifyMode; label: string; hint: string }>;
}) {
  const [value, setValue] = useState<AtlasNotifyMode>(mode);
  const { run, pending, toast } = useAtlasCommand();
  return (
    <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={pending}
            data-testid={`atlas-notify-${o.id}`}
            onClick={() => {
              if (on) return;
              const before = value;
              setValue(o.id);
              run(
                () => atlasNotifyMode(o.id),
                (r) => {
                  if (!r.ok) setValue(before);
                },
              );
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              border: `1px solid ${on ? "var(--viol)" : "var(--line)"}`,
              background: on ? "var(--viol-t)" : "var(--panel)",
              borderRadius: 10,
              padding: "9px 12px",
              cursor: "pointer",
              textAlign: "left",
              fontFamily: "inherit",
              color: "var(--ink)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 14,
                height: 14,
                boxSizing: "border-box",
                borderRadius: "50%",
                border: on ? "4px solid var(--viol)" : "1.5px solid var(--line)",
                flex: "none",
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{o.label}</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{o.hint}</div>
            </div>
          </button>
        );
      })}
      {toast}
    </div>
  );
}
