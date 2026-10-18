"use client";

import { useRef } from "react";
import { addNote } from "./actions";

/**
 * The note field under the timeline: one line, no button — Enter or ⌘↵ posts
 * it, and the form empties itself once the note is in.
 */
export function NoteField({ number, placeholder }: { number: number; placeholder: string }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      action={addNote}
      data-testid="timeline-note"
      style={{ display: "flex", gap: 8, marginTop: 8, paddingLeft: 68 }}
    >
      <input type="hidden" name="number" value={number} />
      <input
        name="message"
        required
        maxLength={2000}
        placeholder={placeholder}
        aria-label={placeholder}
        className="oi-field"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.currentTarget.value.trim()) form.current?.requestSubmit();
          }
        }}
        style={{
          flex: 1,
          height: 34,
          border: "1px solid var(--line)",
          borderRadius: 9,
          padding: "0 11px",
          fontSize: 13,
          outline: "none",
          background: "var(--panel)",
        }}
      />
    </form>
  );
}
