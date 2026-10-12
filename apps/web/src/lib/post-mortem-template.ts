import { z } from "zod";

/**
 * The post-mortem template as a form field: one JSON value, validated and
 * given stable keys. Shared by the two screens that save it.
 */
const templateSchema = z
  .array(
    z.object({
      key: z.string().max(40).optional().default(""),
      title: z.string().trim().min(1).max(120),
      hint: z.string().trim().max(400).default(""),
    }),
  )
  .min(1)
  .max(12);

export type TemplateRow = { key: string; title: string; hint: string };

/** A key for a section: the one it had, or one from its title, unique in the list. */
function templateKey(title: string, given: string, taken: string[]): string {
  if (/^[a-z][a-z0-9_]{0,39}$/.test(given) && !taken.includes(given)) return given;
  const base =
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "section";
  let key = base;
  let i = 2;
  while (taken.includes(key)) key = `${base}_${i++}`;
  return key;
}

/** The parsed template, or `"invalid"`. Never throws. */
export function parseTemplateField(raw: string): TemplateRow[] | "invalid" {
  let value: unknown;
  try {
    value = JSON.parse(raw || "[]");
  } catch {
    return "invalid";
  }
  const parsed = templateSchema.safeParse(value);
  if (!parsed.success) return "invalid";
  const taken: string[] = [];
  return parsed.data.map((row) => {
    const key = templateKey(row.title, row.key, taken);
    taken.push(key);
    return { key, title: row.title, hint: row.hint };
  });
}
