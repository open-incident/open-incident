import { expect, test } from "@playwright/test";
import { dictionaryCodes, localeTags, pluralEntries, simpleEntries } from "./dict-source";

/**
 * Static checks on the dictionaries — no browser: they read the translation
 * files as text and need no instance at all.
 *
 * The `Message` type only requires an `other` form; the others are optional,
 * because no two languages use the same set. So a dictionary missing a plural
 * form its language selects compiles perfectly and prints a wrong sentence.
 */
function expectedCategories(tag: string): string[] {
  const rules = new Intl.PluralRules(tag);
  const seen = new Set<string>(["other"]);
  for (let n = 0; n <= 9_999; n++) seen.add(rules.select(n));
  return [...seen].sort();
}

const REFERENCE = pluralEntries("en");
const CODES = dictionaryCodes();

test.describe("Plural tables", () => {
  test("the source declares plural entries", () => {
    // Guard rail for the guard rail: if the parsing found nothing any more,
    // every test below would go green without verifying anything.
    expect(REFERENCE.size).toBeGreaterThan(5);
  });

  test("every language in the registry has its dictionary", () => {
    const expected = [...localeTags().keys()].filter((c) => c !== "en").sort();
    expect(CODES).toEqual(expected);
  });

  for (const code of CODES) {
    test(`${code}: every category the language can select`, () => {
      const tag = localeTags().get(code);
      expect(tag, `${code} missing from locales.ts`).toBeTruthy();
      const required = expectedCategories(tag!);
      const dict = pluralEntries(code);
      expect([...dict.keys()].sort()).toEqual([...REFERENCE.keys()].sort());
      const missing = [...dict].flatMap(([key, forms]) =>
        required.filter((c) => !(c in forms)).map((c) => `${key} → ${c}`),
      );
      expect(missing, `${code} (${required.join(", ")})`).toEqual([]);
    });
  }
});

/**
 * Vocabulary sets — phases, roles, member statuses. Two values of one set
 * translated by the same word give an unusable filter without anything
 * crashing; English cannot reveal it, being the source.
 */
const SETS: Record<string, RegExp> = {
  phases: /^incident\.phase\./,
  roles: /^member\.role\./,
  "member statuses": /^member\.status\./,
  "follow-up statuses": /^followUp\.status\./,
};

test.describe("Vocabulary sets", () => {
  test("the source sets do count several values each", () => {
    const source = simpleEntries("en");
    for (const [name, re] of Object.entries(SETS)) {
      const n = [...source.keys()].filter((k) => re.test(k)).length;
      expect(n, `set “${name}”`).toBeGreaterThan(1);
    }
  });

  for (const code of CODES) {
    test(`${code}: no duplicate label inside one set`, () => {
      const d = simpleEntries(code);
      const collisions: string[] = [];
      for (const [name, re] of Object.entries(SETS)) {
        const byValue = new Map<string, string[]>();
        for (const key of [...d.keys()].filter((k) => re.test(k))) {
          const value = d.get(key)!;
          if (!byValue.has(value)) byValue.set(value, []);
          byValue.get(value)!.push(key.split(".").pop()!);
        }
        for (const [value, keys] of byValue) {
          if (keys.length > 1) collisions.push(`${name}: “${value}” ← ${keys.join(" = ")}`);
        }
      }
      expect(collisions).toEqual([]);
    });
  }
});

/**
 * Action verbs the translation must not conflate — pairs that meet on the
 * same screen, where clicking one while believing it is the other has a cost.
 */
const PAIRS: [string, string, string][] = [
  ["revoke an invitation vs cancel", "settings.members.revoke", "common.cancel"],
  ["disable a member vs remove", "settings.members.disable", "settings.members.revoke"],
  ["delete the account vs cancel", "account.delete.submit", "common.cancel"],
];

test.describe("Action verbs", () => {
  test("the pairs really are distinct in the source", () => {
    const source = simpleEntries("en");
    for (const [name, a, b] of PAIRS) {
      expect(source.get(a), `${name}: ${a} missing from en.ts`).toBeTruthy();
      expect(source.get(b), `${name}: ${b} missing from en.ts`).toBeTruthy();
      expect(source.get(a), `${name}: already conflated in the source`).not.toBe(source.get(b));
    }
  });

  for (const code of CODES) {
    test(`${code}: no conflated action pair`, () => {
      const d = simpleEntries(code);
      const bare = (v: string | undefined) =>
        (v ?? "")
          .toLocaleLowerCase()
          .replace(/[\s:.…—-]+$/u, "")
          .trim();
      const conflated = PAIRS.filter(([, a, b]) => {
        const bareA = bare(d.get(a));
        return bareA !== "" && bareA === bare(d.get(b));
      }).map(([name, a, b]) => `${name}: “${d.get(a)}” ← ${a} = ${b}`);
      expect(conflated).toEqual([]);
    });
  }
});
