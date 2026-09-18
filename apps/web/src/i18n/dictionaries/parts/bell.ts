/**
 * Labels of the bell, in the three languages.
 *
 * Each language holds exactly the same keys — English is the source the
 * `Dictionary` type derives from, so a gap in another language does not
 * compile.
 *
 * Note the absence of `as const`: the part is spread into `en.ts`, and a
 * literal type there would force the French and German values to be the
 * English string.
 */
import type { Message } from "../../dictionary";

const en = {
  "bell.title": "Notifications",
  "bell.markAll": "Mark all as read",
  "bell.empty": "Nothing for you yet",
  "bell.emptyHint":
    "This is where you find a page you received, an incident you are on, a follow-up assigned to you.",
  "bell.times": { one: "{count} time", other: "{count} times" },
  "bell.note": "The bell never pages. What wakes you up is on-call.",
  "bell.what.declared": "Incident declared",
  "bell.what.updated": "The incident changed",
  "bell.what.updatePublished": "An update was published",
  "bell.what.resolved": "Resolved",
  "bell.mentionedYou": "{name} mentioned you",
  "bell.kind.paged": "paged",
  "bell.kind.incident": "incident",
  "bell.kind.followUp": "follow-up",
  "bell.kind.mention": "mention",
};

type Part = Record<keyof typeof en, Message>;

export const bellPart = {
  en,
  fr: {
    "bell.title": "Notifications",
    "bell.markAll": "Tout marquer comme lu",
    "bell.empty": "Rien pour vous pour l'instant",
    "bell.emptyHint":
      "C'est ici que vous retrouverez une astreinte reçue, un incident que vous suivez, un suivi qui vous est assigné.",
    "bell.times": { one: "{count} fois", other: "{count} fois" },
    "bell.note": "La cloche ne réveille personne. Ce qui vous réveille, c'est l'astreinte.",
    "bell.what.declared": "Incident déclaré",
    "bell.what.updated": "L'incident a changé",
    "bell.what.updatePublished": "Une mise à jour a été publiée",
    "bell.what.resolved": "Résolu",
    "bell.mentionedYou": "{name} vous a mentionné",
    "bell.kind.paged": "appelé",
    "bell.kind.incident": "incident",
    "bell.kind.followUp": "suivi",
    "bell.kind.mention": "mention",
  },
  de: {
    "bell.title": "Benachrichtigungen",
    "bell.markAll": "Alle als gelesen markieren",
    "bell.empty": "Noch nichts für Sie",
    "bell.emptyHint":
      "Hier finden Sie einen erhaltenen Ruf, einen Vorfall, an dem Sie beteiligt sind, eine Ihnen zugewiesene Maßnahme.",
    "bell.times": { one: "{count} Mal", other: "{count} Mal" },
    "bell.note": "Die Glocke ruft niemanden. Was Sie weckt, ist die Rufbereitschaft.",
    "bell.what.declared": "Vorfall gemeldet",
    "bell.what.updated": "Der Vorfall hat sich geändert",
    "bell.what.updatePublished": "Ein Update wurde veröffentlicht",
    "bell.what.resolved": "Behoben",
    "bell.mentionedYou": "{name} hat Sie erwähnt",
    "bell.kind.paged": "gerufen",
    "bell.kind.incident": "Vorfall",
    "bell.kind.followUp": "Maßnahme",
    "bell.kind.mention": "Erwähnung",
  },
} satisfies { en: Part; fr: Part; de: Part };
