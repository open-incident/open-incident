"use client";

import { useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import { addFollowUp } from "./actions";
import { suggestFollowUpsFor } from "./ai-actions";

type Suggestion = { title: string; priority: "P1" | "P2" | "P3" };

/** "Suggest follow-ups" — the assistant proposes, each line becomes a follow-up only when a person clicks Create. */
export function SuggestFollowUps({ number }: { number: number }) {
  const t = useT();
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [created, setCreated] = useState<Set<string>>(new Set());
  const btn: React.CSSProperties = {
    height: 32,
    padding: "0 13px",
    border: "1px solid var(--viol)",
    borderRadius: 8,
    background: "var(--panel)",
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--viol)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          data-testid="ai-suggest-follow-ups"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const out = await suggestFollowUpsFor(number);
              if ("error" in out) setError(out.error);
              else setItems(out.value);
            })
          }
          style={{ ...btn, opacity: pending ? 0.6 : 1 }}
        >
          <span aria-hidden>✦</span>
          {pending ? t("ai.working") : items ? t("ai.followUps.again") : t("ai.followUps.suggest")}
        </button>
        {error && (
          <span role="alert" style={{ fontSize: 12, color: "var(--dang)" }}>
            {error}
          </span>
        )}
      </div>
      {items && (
        <div
          style={{
            border: "1px solid var(--viol)",
            background: "var(--viol-t)",
            borderRadius: 11,
            padding: "10px 13px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--viol)",
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: 10.5,
                letterSpacing: ".08em",
                background: "var(--panel)",
                borderRadius: 6,
                padding: "2px 7px",
              }}
            >
              {t("ai.badge")}
            </span>
            {items.length === 0 ? t("ai.followUps.none") : t("ai.followUps.note")}
          </div>
          {items.map((s) => {
            const done = created.has(s.title);
            return (
              <form
                key={s.title}
                data-testid="ai-suggestion"
                action={async (fd) => {
                  await addFollowUp(fd);
                  setCreated((prev) => new Set(prev).add(s.title));
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 12.5,
                  background: "var(--panel)",
                  borderRadius: 8,
                  padding: "7px 10px",
                }}
              >
                <input type="hidden" name="number" value={number} />
                <input type="hidden" name="title" value={s.title} />
                <input type="hidden" name="priority" value={s.priority} />
                <span
                  style={{
                    padding: "1px 7px",
                    borderRadius: 999,
                    background: "var(--sunk)",
                    fontSize: 10.5,
                    fontWeight: 700,
                    flex: "none",
                  }}
                >
                  {s.priority}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    textDecoration: done ? "line-through" : "none",
                    color: done ? "var(--ink-3)" : "var(--ink)",
                  }}
                >
                  {s.title}
                </span>
                {done ? (
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ok)" }}>
                    {t("ai.followUps.created")}
                  </span>
                ) : (
                  <button
                    type="submit"
                    style={{
                      height: 26,
                      padding: "0 10px",
                      borderRadius: 7,
                      background: "var(--brand)",
                      color: "#fff",
                      border: 0,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {t("common.create")}
                  </button>
                )}
              </form>
            );
          })}
        </div>
      )}
    </div>
  );
}
