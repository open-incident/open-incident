/**
 * Labels added by the V2 design pass — settings-v2. English is the source; French and
 * German carry exactly the same keys (a gap does not compile). No `as const`.
 *
 * The settings are twenty screens; their labels live in one file per family
 * under ./settings-v2/, each with the same three languages, and are spread in
 * here.
 */
import type { Message } from "../../dictionary";
import { commonPart } from "./settings-v2/common";
import { navPart } from "./settings-v2/nav";
import { workspacePart } from "./settings-v2/workspace";
import { peoplePart } from "./settings-v2/people";
import { incidentsPart } from "./settings-v2/incidents";
import { alertsPart } from "./settings-v2/alerts";
import { platformPart } from "./settings-v2/platform";

const en = {
  ...commonPart.en,
  ...navPart.en,
  ...workspacePart.en,
  ...peoplePart.en,
  ...incidentsPart.en,
  ...alertsPart.en,
  ...platformPart.en,
};

type Part = Record<keyof typeof en, Message>;

export const settingsV2Part = {
  en,
  fr: {
    ...commonPart.fr,
    ...navPart.fr,
    ...workspacePart.fr,
    ...peoplePart.fr,
    ...incidentsPart.fr,
    ...alertsPart.fr,
    ...platformPart.fr,
  },
  de: {
    ...commonPart.de,
    ...navPart.de,
    ...workspacePart.de,
    ...peoplePart.de,
    ...incidentsPart.de,
    ...alertsPart.de,
    ...platformPart.de,
  },
} satisfies { en: Part; fr: Part; de: Part };
