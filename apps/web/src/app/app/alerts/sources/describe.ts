/**
 * The words the three choices are shown with, on the cards, on the source page
 * and in the connect dialog — written once so the chip and the card can never
 * disagree.
 */
import type { MessageParams } from "@/i18n/dictionary";
import type { MessageKey } from "@/i18n/dictionaries/en";
import type { IncidentChoice, PageChoice } from "./choices";

/** Enough of `t` for a label: the server's and the client's both satisfy it. */
export type Labeller = (key: MessageKey, params?: MessageParams) => string;

export function describePage(t: Labeller, page: PageChoice, readerId: string): string {
  switch (page.kind) {
    case "owner":
      return t("alt2.choice.page.owner");
    case "member":
      return page.memberId === readerId ? t("alt2.choice.page.me") : page.name;
    case "team":
    case "schedule":
    case "path":
      return page.name;
    case "nobody":
      return t("alt2.choice.page.nobody");
  }
}

export function describeIncident(
  t: Labeller,
  incident: IncidentChoice,
  urgentFrom: string | null,
): string {
  if (incident === "triage") return t("alt2.choice.incident.triage");
  if (incident === "never") return t("alt2.choice.incident.never");
  return urgentFrom
    ? t("alt2.choice.incident.urgentFrom", { priority: urgentFrom })
    : t("alt2.choice.incident.urgent");
}
