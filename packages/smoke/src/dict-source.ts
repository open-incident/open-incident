import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Reading the translation dictionaries from their source.
 *
 * This package has neither `apps/web`'s path aliases nor its bundler: importing
 * `@/i18n/dictionaries/pl` from here would mean recreating its configuration to
 * read a table of constants. So the file is scanned as text, which is enough
 * for the two questions asked of it: which keys carry plural forms, and which
 * forms exactly.
 *
 * This package is transpiled to CommonJS by Playwright's loader:
 * `__dirname` is available, `import.meta` is not.
 */

const DICTS = join(__dirname, "../../../apps/web/src/i18n/dictionaries");
const LOCALES_TS = join(DICTS, "../locales.ts");

/** `{ code: "pl", tag: "pl-PL" }` → the tag that carries the plural rules. */
export function localeTags(): Map<string, string> {
  const src = readFileSync(LOCALES_TS, "utf8");
  return new Map(
    [...src.matchAll(/\{ code: "(\w+)", tag: "([\w-]+)"/g)].map((m) => [m[1]!, m[2]!]),
  );
}

/** The codes that have a dictionary file, English excluded (it is the source). */
export function dictionaryCodes(): string[] {
  return readdirSync(DICTS)
    .filter((f) => f.endsWith(".ts") && f !== "en.ts")
    .map((f) => f.replace(".ts", ""))
    .sort();
}

/**
 * A dictionary's plural entries: key → { form: text }.
 *
 * A plural entry is written `"key": { one: "…", other: "…" }` on a single line
 * or across several. So the start is spotted, then read up to the closing
 * brace — the braces of the parameters (`{count}`) always come in pairs, which
 * makes the counting reliable. The `\s*` after the colon is indispensable: a
 * form with a long text wraps onto the next line.
 */
export function pluralEntries(code: string): Map<string, Record<string, string>> {
  const lines = readFileSync(join(DICTS, `${code}.ts`), "utf8").split("\n");
  const out = new Map<string, Record<string, string>>();
  for (let i = 0; i < lines.length; i++) {
    const start = /^ {2}"([^"]+)": \{/.exec(lines[i]!);
    if (!start) continue;
    let acc = lines[i]!;
    while ((acc.match(/\{/g) ?? []).length !== (acc.match(/\}/g) ?? []).length) {
      acc += `\n${lines[++i]!}`;
    }
    const forms: Record<string, string> = {};
    for (const m of acc.matchAll(/(?:^|[{\s])(\w+):\s*"((?:[^"\\]|\\.)*)"/g)) {
      forms[m[1]!] = m[2]!.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    out.set(start[1]!, forms);
  }
  return out;
}

/**
 * A dictionary's plain-value entries: key → text.
 *
 * Used by the checks that compare labels with one another — the vocabulary
 * sets, for instance, where two identical values would make a filter unusable.
 */
export function simpleEntries(code: string): Map<string, string> {
  const src = readFileSync(join(DICTS, `${code}.ts`), "utf8");
  const out = new Map<string, string>();
  for (const m of src.matchAll(/^ {2}"([^"]+)": "((?:[^"\\]|\\.)*)",$/gm)) {
    out.set(m[1]!, m[2]!);
  }
  return out;
}
