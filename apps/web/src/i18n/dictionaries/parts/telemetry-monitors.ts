/**
 * Labels added by the V2 design pass — telemetry-monitors. English is the source; French and
 * German carry exactly the same keys (a gap does not compile). No `as const`.
 */
import type { Message } from "../../dictionary";

const en = {};

type Part = Record<keyof typeof en, Message>;

export const telemetryMonitorsPart = {
  en,
  fr: {},
  de: {},
} satisfies { en: Part; fr: Part; de: Part };
