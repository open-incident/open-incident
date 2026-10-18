/**
 * Labels added by the V2 design pass — oncall-v2. English is the source; French and
 * German carry exactly the same keys (a gap does not compile). No `as const`.
 */
import type { Message } from "../../dictionary";

const en = {
  /* ---------- Now ---------- */
  "ocv2.now.rotationMeta": "{name} rotation",
  "ocv2.now.offHours": "off-hours · on call again {when}",
  "ocv2.now.chainTeam": "{name} team",
  "ocv2.now.coverSent": {
    one: "Cover request sent to {count} member — the first to accept gets an override for {from} → {to}.",
    other:
      "Cover request sent to {count} members — the first to accept gets an override for {from} → {to}.",
  },
  "ocv2.now.weekendsTitle": "Week-ends · next two months",
  "ocv2.now.week": "Week",
  "ocv2.now.month": "Month",
  "ocv2.now.people": "☰ People · {count}",
  "ocv2.now.removePartial": "Remove the {from} – {to} override",
  "ocv2.now.slotEnded": "This shift is over — it stays as it was worked.",

  /* ---------- People of a rotation ---------- */
  "ocv2.people.title": "{name} — turn order",
  "ocv2.people.applies": "Changes apply at the next handover · {when}",
  "ocv2.people.pending": "New order from the next handover · {when}",
  "ocv2.people.current": "current shift · until {when}",
  "ocv2.people.leaves": "leaves the rotation at the handover · {when}",
  "ocv2.people.keep": "Keep in the rotation",
  "ocv2.people.from": "from {when}",
  "ocv2.people.add": "+ {name}",
  "ocv2.people.addAria": "Add {name} to the rotation",

  /* ---------- Schedules ---------- */
  "ocv2.sched.followSun": "follow-the-sun",
  "ocv2.sched.intervalFollowSun": "Follow-the-sun",

  /* ---------- Policies ---------- */
  "ocv2.pol.chipPeople": { one: "{count} person", other: "{count} people" },
  "ocv2.pol.atlasTitle": "✦ Atlas tries first.",
  "ocv2.pol.atlasBody":
    "Every policy starts with Atlas. What happens next depends on the service: at level 3 Atlas fixes and the person is paged at the same moment; at level 4 nobody is paged unless Atlas gets stuck, hits a limit or is stopped. Below level 3 the policy runs as written.",
  "ocv2.pol.teamsLink": "Teams and their default policy →",

  /* ---------- My notifications ---------- */
  "ocv2.notif.slackTitle": "Slack — direct message",
  "ocv2.notif.teamsTitle": "Microsoft Teams — chat",
  "ocv2.notif.withAck": "{who} · with Acknowledge",
  "ocv2.notif.linked": "linked",
  "ocv2.notif.unavailableSlackApp":
    "Unavailable on this instance — no Slack app configured. Ask your admin.",
  "ocv2.notif.unavailableTeamsApp":
    "Unavailable on this instance — no Microsoft Teams app configured. Ask your admin.",
  "ocv2.notif.testQueued":
    "Test queued — {channels} are on their way. Statuses below are real: queued → sent → delivered.",
  "ocv2.notif.short.slack": "Slack",
  "ocv2.notif.short.teams": "Teams",
  "ocv2.notif.short.webpush": "push",
  "ocv2.notif.short.voice": "call",
  "ocv2.notif.short.sms": "SMS",
  "ocv2.notif.short.email": "email",
  "ocv2.notif.step.slack": "Slack message",
  "ocv2.notif.step.teams": "Teams message",
  "ocv2.notif.step.webpush": "Push",
  "ocv2.notif.step.voice": "Voice call",
  "ocv2.notif.step.sms": "SMS",
  "ocv2.notif.step.email": "Email",
  "ocv2.notif.step.digest": "Email digest",
  "ocv2.notif.retry": "{label} · retry",
  "ocv2.notif.silent": " · silent",
  "ocv2.notif.at": "at {time}",
  "ocv2.notif.afterNoAck": {
    one: "after {count} min without ack",
    other: "after {count} min without ack",
  },
  "ocv2.notif.afterMin": { one: "after {count} min", other: "after {count} min" },
  "ocv2.notif.cannotReach":
    "Cannot reach you here yet: unavailable on this instance, or not linked.",
  "ocv2.notif.fallback":
    "Nothing in this rule can reach you on this instance yet — pages go to {email} instead.",
  "ocv2.notif.addCta": "Add",
  "ocv2.notif.dmOff":
    "Turned off for this workspace — an admin offers it in Settings › Slack & Teams.",
};

type Part = Record<keyof typeof en, Message>;

export const oncallV2Part = {
  en,
  fr: {
    /* ---------- Now ---------- */
    "ocv2.now.rotationMeta": "rotation {name}",
    "ocv2.now.offHours": "hors horaires · de nouveau d'astreinte {when}",
    "ocv2.now.chainTeam": "équipe {name}",
    "ocv2.now.coverSent": {
      one: "Demande de remplacement envoyée à {count} membre — le premier qui accepte reçoit un remplacement pour {from} → {to}.",
      other:
        "Demande de remplacement envoyée à {count} membres — le premier qui accepte reçoit un remplacement pour {from} → {to}.",
    },
    "ocv2.now.weekendsTitle": "Week-ends · deux prochains mois",
    "ocv2.now.week": "Semaine",
    "ocv2.now.month": "Mois",
    "ocv2.now.people": "☰ Personnes · {count}",
    "ocv2.now.removePartial": "Retirer le remplacement {from} – {to}",
    "ocv2.now.slotEnded": "Ce créneau est passé — il reste tel qu'il a été tenu.",

    /* ---------- People of a rotation ---------- */
    "ocv2.people.title": "{name} — ordre de passage",
    "ocv2.people.applies": "Les changements s'appliquent à la prochaine relève · {when}",
    "ocv2.people.pending": "Nouvel ordre à partir de la prochaine relève · {when}",
    "ocv2.people.current": "créneau en cours · jusqu'à {when}",
    "ocv2.people.leaves": "quitte la rotation à la relève · {when}",
    "ocv2.people.keep": "Garder dans la rotation",
    "ocv2.people.from": "à partir de {when}",
    "ocv2.people.add": "+ {name}",
    "ocv2.people.addAria": "Ajouter {name} à la rotation",

    /* ---------- Schedules ---------- */
    "ocv2.sched.followSun": "follow-the-sun",
    "ocv2.sched.intervalFollowSun": "Follow-the-sun",

    /* ---------- Policies ---------- */
    "ocv2.pol.chipPeople": { one: "{count} personne", other: "{count} personnes" },
    "ocv2.pol.atlasTitle": "✦ Atlas essaie d'abord.",
    "ocv2.pol.atlasBody":
      "Chaque politique commence par Atlas. La suite dépend du service : au niveau 3, Atlas corrige et la personne est appelée au même moment ; au niveau 4, personne n'est appelé sauf si Atlas bloque, atteint une limite ou est arrêté. En dessous du niveau 3, la politique s'exécute telle qu'elle est écrite.",
    "ocv2.pol.teamsLink": "Les équipes et leur politique par défaut →",

    /* ---------- My notifications ---------- */
    "ocv2.notif.slackTitle": "Slack — message direct",
    "ocv2.notif.teamsTitle": "Microsoft Teams — conversation",
    "ocv2.notif.withAck": "{who} · avec Acquitter",
    "ocv2.notif.linked": "lié",
    "ocv2.notif.unavailableSlackApp":
      "Indisponible sur cette instance — aucune application Slack configurée. Demandez à votre administrateur.",
    "ocv2.notif.unavailableTeamsApp":
      "Indisponible sur cette instance — aucune application Microsoft Teams configurée. Demandez à votre administrateur.",
    "ocv2.notif.testQueued":
      "Test en file — {channels} sont en route. Les statuts ci-dessous sont réels : en file → envoyé → remis.",
    "ocv2.notif.short.slack": "Slack",
    "ocv2.notif.short.teams": "Teams",
    "ocv2.notif.short.webpush": "push",
    "ocv2.notif.short.voice": "appel",
    "ocv2.notif.short.sms": "SMS",
    "ocv2.notif.short.email": "e-mail",
    "ocv2.notif.step.slack": "Message Slack",
    "ocv2.notif.step.teams": "Message Teams",
    "ocv2.notif.step.webpush": "Push",
    "ocv2.notif.step.voice": "Appel vocal",
    "ocv2.notif.step.sms": "SMS",
    "ocv2.notif.step.email": "E-mail",
    "ocv2.notif.step.digest": "Récapitulatif par e-mail",
    "ocv2.notif.retry": "{label} · nouvel essai",
    "ocv2.notif.silent": " · silencieux",
    "ocv2.notif.at": "à {time}",
    "ocv2.notif.afterNoAck": {
      one: "après {count} min sans acquittement",
      other: "après {count} min sans acquittement",
    },
    "ocv2.notif.afterMin": { one: "après {count} min", other: "après {count} min" },
    "ocv2.notif.cannotReach":
      "Ne peut pas encore vous joindre : indisponible sur cette instance, ou non lié.",
    "ocv2.notif.fallback":
      "Rien dans cette règle ne peut encore vous joindre sur cette instance — les appels partent vers {email} à la place.",
    "ocv2.notif.addCta": "Ajouter",
    "ocv2.notif.dmOff":
      "Désactivé pour cet espace — un administrateur le propose dans Paramètres › Slack & Teams.",
  },
  de: {
    /* ---------- Now ---------- */
    "ocv2.now.rotationMeta": "Rotation {name}",
    "ocv2.now.offHours": "außerhalb der Zeiten · wieder in Bereitschaft {when}",
    "ocv2.now.chainTeam": "Team {name}",
    "ocv2.now.coverSent": {
      one: "Vertretungsanfrage an {count} Mitglied gesendet — wer zuerst annimmt, erhält eine Ersetzung für {from} → {to}.",
      other:
        "Vertretungsanfrage an {count} Mitglieder gesendet — wer zuerst annimmt, erhält eine Ersetzung für {from} → {to}.",
    },
    "ocv2.now.weekendsTitle": "Wochenenden · nächste zwei Monate",
    "ocv2.now.week": "Woche",
    "ocv2.now.month": "Monat",
    "ocv2.now.people": "☰ Personen · {count}",
    "ocv2.now.removePartial": "Ersetzung {from} – {to} entfernen",
    "ocv2.now.slotEnded": "Diese Schicht ist vorbei — sie bleibt, wie sie geleistet wurde.",

    /* ---------- People of a rotation ---------- */
    "ocv2.people.title": "{name} — Reihenfolge",
    "ocv2.people.applies": "Änderungen gelten ab der nächsten Übergabe · {when}",
    "ocv2.people.pending": "Neue Reihenfolge ab der nächsten Übergabe · {when}",
    "ocv2.people.current": "laufende Schicht · bis {when}",
    "ocv2.people.leaves": "verlässt die Rotation bei der Übergabe · {when}",
    "ocv2.people.keep": "In der Rotation behalten",
    "ocv2.people.from": "ab {when}",
    "ocv2.people.add": "+ {name}",
    "ocv2.people.addAria": "{name} zur Rotation hinzufügen",

    /* ---------- Schedules ---------- */
    "ocv2.sched.followSun": "Follow-the-Sun",
    "ocv2.sched.intervalFollowSun": "Follow-the-Sun",

    /* ---------- Policies ---------- */
    "ocv2.pol.chipPeople": { one: "{count} Person", other: "{count} Personen" },
    "ocv2.pol.atlasTitle": "✦ Atlas versucht es zuerst.",
    "ocv2.pol.atlasBody":
      "Jede Richtlinie beginnt mit Atlas. Was danach passiert, hängt vom Dienst ab: Auf Stufe 3 behebt Atlas und die Person wird im selben Moment alarmiert; auf Stufe 4 wird niemand alarmiert, außer Atlas bleibt hängen, erreicht eine Grenze oder wird gestoppt. Unter Stufe 3 läuft die Richtlinie wie geschrieben.",
    "ocv2.pol.teamsLink": "Teams und ihre Standardrichtlinie →",

    /* ---------- My notifications ---------- */
    "ocv2.notif.slackTitle": "Slack — Direktnachricht",
    "ocv2.notif.teamsTitle": "Microsoft Teams — Chat",
    "ocv2.notif.withAck": "{who} · mit Bestätigen",
    "ocv2.notif.linked": "verknüpft",
    "ocv2.notif.unavailableSlackApp":
      "Auf dieser Instanz nicht verfügbar — keine Slack-App konfiguriert. Fragen Sie Ihre Administration.",
    "ocv2.notif.unavailableTeamsApp":
      "Auf dieser Instanz nicht verfügbar — keine Microsoft-Teams-App konfiguriert. Fragen Sie Ihre Administration.",
    "ocv2.notif.testQueued":
      "Test eingereiht — {channels} sind unterwegs. Die Status unten sind echt: eingereiht → gesendet → zugestellt.",
    "ocv2.notif.short.slack": "Slack",
    "ocv2.notif.short.teams": "Teams",
    "ocv2.notif.short.webpush": "Push",
    "ocv2.notif.short.voice": "Anruf",
    "ocv2.notif.short.sms": "SMS",
    "ocv2.notif.short.email": "E-Mail",
    "ocv2.notif.step.slack": "Slack-Nachricht",
    "ocv2.notif.step.teams": "Teams-Nachricht",
    "ocv2.notif.step.webpush": "Push",
    "ocv2.notif.step.voice": "Sprachanruf",
    "ocv2.notif.step.sms": "SMS",
    "ocv2.notif.step.email": "E-Mail",
    "ocv2.notif.step.digest": "E-Mail-Zusammenfassung",
    "ocv2.notif.retry": "{label} · erneut",
    "ocv2.notif.silent": " · lautlos",
    "ocv2.notif.at": "um {time}",
    "ocv2.notif.afterNoAck": {
      one: "nach {count} Min. ohne Bestätigung",
      other: "nach {count} Min. ohne Bestätigung",
    },
    "ocv2.notif.afterMin": { one: "nach {count} Min.", other: "nach {count} Min." },
    "ocv2.notif.cannotReach":
      "Erreicht Sie hier noch nicht: auf dieser Instanz nicht verfügbar oder nicht verknüpft.",
    "ocv2.notif.fallback":
      "Nichts in dieser Regel erreicht Sie auf dieser Instanz bisher — Alarme gehen stattdessen an {email}.",
    "ocv2.notif.addCta": "Hinzufügen",
    "ocv2.notif.dmOff":
      "Für diesen Arbeitsbereich ausgeschaltet — eine Administration bietet es unter Einstellungen › Slack & Teams an.",
  },
} satisfies { en: Part; fr: Part; de: Part };
