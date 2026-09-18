/**
 * The dictionary, in parts.
 *
 * The three language files used to be the only place a new label could land,
 * which made them the one file everybody touched at once. A screen's labels now
 * live in their own part, in the three languages side by side, and the language
 * files spread the parts in. Two screens can be written at the same time
 * without either losing the other's work, and a translator reads one screen's
 * wording as a block rather than hunting a prefix through three thousand lines.
 *
 * A part is `{ en, fr, de }` with exactly the same keys in each: the
 * `Dictionary` type still derives from English, so a missing or extra key in
 * another language is a compile error, as before.
 *
 * Adding a part: create the file, import it here, and spread it in the three
 * groups below. Nothing else changes.
 */

import { incidentsPart } from "./incidents";
import { alertsPart } from "./alerts";
import { oncallPart } from "./oncall";
import { statusPagesPart } from "./status-pages";
import { settingsPart } from "./settings";
import { bellPart } from "./bell";

export const partsEn = {
  ...incidentsPart.en,
  ...alertsPart.en,
  ...oncallPart.en,
  ...statusPagesPart.en,
  ...settingsPart.en,
  ...bellPart.en,
} as const;

export const partsFr = {
  ...incidentsPart.fr,
  ...alertsPart.fr,
  ...oncallPart.fr,
  ...statusPagesPart.fr,
  ...settingsPart.fr,
  ...bellPart.fr,
};

export const partsDe = {
  ...incidentsPart.de,
  ...alertsPart.de,
  ...oncallPart.de,
  ...statusPagesPart.de,
  ...settingsPart.de,
  ...bellPart.de,
};
