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
import { syntheticPart } from "./synthetic";
import { servicesPart } from "./services";
import { shellHomePart } from "./shell-home";
import { incidentsV2Part } from "./incidents-v2";
import { alertsStatusPart } from "./alerts-status";
import { telemetryMonitorsPart } from "./telemetry-monitors";
import { oncallV2Part } from "./oncall-v2";
import { servicesInsightsPart } from "./services-insights";
import { settingsV2Part } from "./settings-v2";
import { chatV2Part } from "./chat-v2";
import { migratePart } from "./migrate";
import { atlasCorePart } from "./atlas-core";
import { atlasUiPart } from "./atlas-ui";

export const partsEn = {
  ...incidentsPart.en,
  ...alertsPart.en,
  ...oncallPart.en,
  ...statusPagesPart.en,
  ...settingsPart.en,
  ...bellPart.en,
  ...syntheticPart.en,
  ...servicesPart.en,
  ...shellHomePart.en,
  ...incidentsV2Part.en,
  ...alertsStatusPart.en,
  ...telemetryMonitorsPart.en,
  ...oncallV2Part.en,
  ...servicesInsightsPart.en,
  ...settingsV2Part.en,
  ...chatV2Part.en,
  ...migratePart.en,
  ...atlasCorePart.en,
  ...atlasUiPart.en,
} as const;

export const partsFr = {
  ...incidentsPart.fr,
  ...alertsPart.fr,
  ...oncallPart.fr,
  ...statusPagesPart.fr,
  ...settingsPart.fr,
  ...bellPart.fr,
  ...syntheticPart.fr,
  ...servicesPart.fr,
  ...shellHomePart.fr,
  ...incidentsV2Part.fr,
  ...alertsStatusPart.fr,
  ...telemetryMonitorsPart.fr,
  ...oncallV2Part.fr,
  ...servicesInsightsPart.fr,
  ...settingsV2Part.fr,
  ...chatV2Part.fr,
  ...migratePart.fr,
  ...atlasCorePart.fr,
  ...atlasUiPart.fr,
};

export const partsDe = {
  ...incidentsPart.de,
  ...alertsPart.de,
  ...oncallPart.de,
  ...statusPagesPart.de,
  ...settingsPart.de,
  ...bellPart.de,
  ...syntheticPart.de,
  ...servicesPart.de,
  ...shellHomePart.de,
  ...incidentsV2Part.de,
  ...alertsStatusPart.de,
  ...telemetryMonitorsPart.de,
  ...oncallV2Part.de,
  ...servicesInsightsPart.de,
  ...settingsV2Part.de,
  ...chatV2Part.de,
  ...migratePart.de,
  ...atlasCorePart.de,
  ...atlasUiPart.de,
};
