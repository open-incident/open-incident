# Adding a language

The software ships in three languages today — English (the source), French and
German — and targets the 24 official languages of the European Union plus
Norwegian. Each workspace sets its language (`workspaces.locale`); a member may
override it for themselves (`members.locale`): an on-call rota spans countries,
and the person woken at 3 a.m. reads in their own language.

`en.ts` is the source. The other dictionaries are typed against it, so a
forgotten key is a compile error. That is the only guarantee the compiler gives
— everything else on this page describes what it does not see.

## The procedure

1. Add the entry to [`locales.ts`](locales.ts): `code`, BCP-47 `tag`,
   `nativeName` in the language itself, `dir`.
2. Write `dictionaries/<code>.ts`, modelled on `en.ts` — same keys, same order,
   same section markers. A review then reads as a side-by-side diff.
3. Import it in [`server.ts`](server.ts) and add it to `DICTIONARIES`.
4. Run the checks: `pnpm --filter @openincident/smoke exec playwright test
src/i18n-source.spec.ts` — it needs no running instance.

## The traps, every one covered by a test

**Plural forms.** `Message` only requires `other`; the rest are optional, since
no two languages use the same set. Supply every category that
`new Intl.PluralRules(tag).resolvedOptions().pluralCategories` returns for whole
numbers; the `many` of Czech, Slovak and Lithuanian is the admitted exception
(decimals only).

**Undeclined proper nouns.** The product interpolates names exactly as entered,
in the nominative: it cannot build a genitive or append a case suffix. Prefer a
common noun that carries the case in front of the proper noun, or a sentence
turned around to make the parameter its subject.

**Destructive verbs that blur together.** Check that "revoke", "delete",
"disable", "remove", "close" and "cancel" stay distinguishable **when they live
on the same screen**.

**Vocabulary sets.** Phases, roles, member statuses live in tables away from
the screens that display them; two identical values in one set give an unusable
filter without anything breaking.

## Nothing translatable lives outside this folder

`packages/smoke/src/i18n-hardcoded.spec.ts` sweeps `apps/web/src` outside
`i18n/` and rejects any accented text that does not go through `t()`. It keys on
accents, so a hardcoded English label slips through: add the key first, then
use it.

## What is not translated

Brands and technical acronyms, keyboard keys (`⌘K`, `↵`), the product's own
identifiers (`INC-217`, `SEV2`, `P1` — mono on screen, they are values, not
text), machine keys of custom fields and catalog attributes. Statuses a
workspace names itself (Investigation, Confinement…) are its data, not ours.

## Formats: do not write them, delegate them

Dates, times, numbers, plurals, relative time and durations all go through
`Intl` via [`LocaleFormat`](format.ts), in the member's timezone. A number
interpolated into a sentence is formatted by `interpolate` with the locale.
