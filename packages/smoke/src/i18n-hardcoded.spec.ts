import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * No translatable text may live outside the dictionaries.
 *
 * This check exists because the mistake was made at scale: in a previous
 * product a hundred and forty-eight strings were written straight into the code.
 * They stayed in one language whatever the workspace was set to,
 * and nothing flagged it: it compiles, it renders, and only a reader of another
 * language notices.
 *
 * It is therefore the static counterpart of the translation work: the type
 * system guarantees no KEY is missing from a language, this guarantees no TEXT
 * bypasses the dictionary.
 *
 * The signal is the accent: a screen-bound string carrying é, è, à, ç, ê, î, ô,
 * û or ù comes from a translation, and the product holds no such source outside
 * `i18n/`. Its limit is worth stating — since the source dictionary is English,
 * a hardcoded ENGLISH label slips through. The accent catch is kept because it
 * still covers the likeliest accident, French text typed in by hand, and
 * because a check with no false positives is a check that survives.
 */

const SRC = join(__dirname, "../../../apps/web/src");
const SRCS = [SRC];
const ACCENTS = /[éèêëàâäçîïôöûùü]/i;

/**
 * What is allowed to stay, and why. Every entry is a decision, not a comfort
 * exemption: if this list grows without justification, it is the sign we are
 * starting over.
 */
const ALLOWED: { file: string; contains: string; why: string }[] = [];

/** Every TypeScript file of the product, dictionaries excluded. */
function sources(): string[] {
  const out: string[] = [];
  function walk(d: string) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) {
        if (e !== "i18n" && e !== "node_modules" && e !== ".next") walk(p);
      } else if (/\.tsx?$/.test(e)) out.push(p);
    }
  }
  for (const root of SRCS) walk(root);
  return out.sort();
}

/**
 * Strips comments — prose there is legitimate.
 *
 * `/* … *\/` and `{/* … *\/}` blocks go in one pass over the whole text, since
 * they run across several lines. End-of-line comments are only stripped when
 * they do not follow a colon, which spares URLs.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => {
      const i = l.indexOf("//");
      return i > 0 && l[i - 1] !== ":" ? l.slice(0, i) : i === 0 ? "" : l;
    })
    .join("\n");
}

/** A file's screen-bound text: literals and JSX nodes. */
function candidates(code: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  for (const [i, l] of code.split("\n").entries()) {
    // A line that already translates, throws or imports is not at fault.
    if (/\bt\(|\btr\(|console\.|throw new Error|^import |from "/.test(l)) continue;
    const found = [
      ...[...l.matchAll(/"([^"\\]{3,})"/g)].map((m) => m[1]!),
      ...[...l.matchAll(/`([^`\\$]{3,})`/g)].map((m) => m[1]!),
      ...[...l.matchAll(/>\s*([^<>{}][^<>{}]{2,}?)\s*</g)].map((m) => m[1]!),
    ];
    for (const raw of found) {
      const text = raw.trim();
      if (!ACCENTS.test(text)) continue;
      // Paths, utility classes and CSS declarations are not text.
      if (/^[\w./#:%-]+$/.test(text) || /var\(--|rgba?\(|\d+px|;\s*$/.test(text)) continue;
      out.push({ line: i + 1, text });
    }
  }
  return out;
}

test.describe("Hardcoded translatable text", () => {
  test("the exception list describes cases that still exist", () => {
    // An exception that no longer matches anything is an exception to remove:
    // without this guard, the list fills up with stale permissions.
    for (const a of ALLOWED) {
      const path = join(SRC, a.file);
      const source = readFileSync(path, "utf8");
      expect(source, `${a.file} no longer contains "${a.contains}"`).toContain(a.contains);
    }
  });

  test("no translatable text lives outside i18n/", () => {
    const faults: string[] = [];
    for (const path of sources()) {
      const root = SRCS.find((r) => path.startsWith(r))!;
      const rel = relative(root, path);
      const code = withoutComments(readFileSync(path, "utf8"));
      for (const { line, text } of candidates(code)) {
        const allowed = ALLOWED.some(
          (a) => a.file === rel && (text.includes(a.contains) || a.contains.includes(text)),
        );
        if (!allowed) faults.push(`${rel}:${line} — "${text.slice(0, 70)}"`);
      }
    }
    expect(
      faults,
      `Text outside the dictionaries:\n${faults.join("\n")}\n\n` +
        "Add a key to the dictionaries, or justify the exception in ALLOWED.",
    ).toEqual([]);
  });
});
