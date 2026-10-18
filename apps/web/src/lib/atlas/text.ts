/**
 * The words of a journal row, in the reader's language — owner: atlas-core.
 *
 * The engine stores its fixed sentences as a dictionary key with parameters
 * (`payload.text = { key: "atlas.j.checks", params: { n: 6 } }`) and an English
 * `title` beside it; what the model wrote (the fix itself, in the incident's
 * language) is stored as is. Screens call `journalTitle(row, t)` and get the
 * right one. Works for timeline events too (their payload carries the same
 * `text` and `title`).
 */
type Translate = (key: never, params?: Record<string, string | number>) => string;

export type JournalText = { key: string; params?: Record<string, string | number> };

type Readable = { title?: unknown; payload?: Record<string, unknown> | null };

/** The fixed sentence of a row or a timeline payload, translated — else its stored title. */
export function journalTitle(row: Readable, t: Translate): string {
  const text = row.payload?.text as JournalText | undefined;
  const stored = typeof row.title === "string" ? row.title : String(row.payload?.title ?? "");
  if (!text || typeof text.key !== "string" || !text.key.startsWith("atlas.j.")) return stored;
  const out = (t as unknown as (k: string, p?: Record<string, string | number>) => string)(
    text.key,
    text.params,
  );
  // An unknown key comes back as itself: keep the stored words then.
  return out === text.key ? stored : out;
}

/** What the fix does (imperative) and what it did (past), as the model wrote them. */
export function fixWords(row: Readable): { todo: string | null; done: string | null } {
  const p = row.payload ?? {};
  return {
    todo: typeof p.todo === "string" ? p.todo : null,
    done: typeof p.done === "string" ? p.done : null,
  };
}
