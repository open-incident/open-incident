import type { MessageKey } from "@/i18n/dictionaries/en";

/** The inks a level may take — tokens only, and the label the dialog gives each. */
export const COLOURS = [
  "var(--dang)",
  "var(--wait)",
  "var(--open)",
  "var(--viol)",
  "var(--ok)",
  "var(--ink-3)",
] as const;

export const COLOUR_LABELS: Record<(typeof COLOURS)[number], MessageKey> = {
  "var(--dang)": "settingsV2.asev.colourRed",
  "var(--wait)": "settingsV2.asev.colourAmber",
  "var(--open)": "settingsV2.asev.colourBlue",
  "var(--viol)": "settingsV2.asev.colourViolet",
  "var(--ok)": "settingsV2.asev.colourGreen",
  "var(--ink-3)": "settingsV2.asev.colourGrey",
};
