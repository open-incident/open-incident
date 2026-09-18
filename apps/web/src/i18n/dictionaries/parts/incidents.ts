/**
 * Labels of the incidents screens, in the three languages.
 *
 * Each language holds exactly the same keys — English is the source the
 * `Dictionary` type derives from, so a gap in another language does not
 * compile.
 *
 * Everything the V2 incident screens say that the first design did not is
 * prefixed `inc2.`; the labels both designs share keep their original keys in
 * the language files.
 */

import type { Message } from "../../dictionary";

const en = {
  /* ---------- List ---------- */
  "inc2.title": "Incidents",
  "inc2.tab.open": "Open",
  "inc2.tab.triage": "Triage",
  "inc2.tab.post": "Post-incident",
  "inc2.tab.all": "All",
  "inc2.tabsLabel": "Views",
  "inc2.declare": "Declare incident",
  "inc2.empty": "Nothing in this view.",
  "inc2.emptySearch": "No incident matches “{q}”.",
  "inc2.searchResults": "Results for “{q}”",
  "inc2.searchClear": "Clear",
  "inc2.allNote":
    "Open, in triage, in post-incident, and closed in the last seven days. Older incidents are in the reports.",
  "inc2.unassigned": "Unassigned",
  "inc2.listLabel": "Incidents",

  /* ---------- Detail — header ---------- */
  "inc2.back": "Incidents",
  "inc2.window": "{start} → {end} · {duration}",
  "inc2.ongoing": "since {start} · {duration}",
  "inc2.publish": "Publish",
  "inc2.resolve": "Declare resolved",
  "inc2.dtab.timeline": "Timeline",
  "inc2.dtab.atlas": "Atlas",
  "inc2.dtab.rca": "Root cause analysis",
  "inc2.dtab.context": "Context",
  "inc2.dtab.post": "Post-incident",

  /* ---------- Detail — timeline ---------- */
  "inc2.tl.live": "live",
  "inc2.tl.notePlaceholder": "Add a note…",
  "inc2.tl.notePost": "Post",
  "inc2.tl.empty": "No event yet.",

  /* ---------- Detail — side cards ---------- */
  "inc2.card.services": "Services",
  "inc2.card.alerts": "Alerts",
  "inc2.card.alertGroups": { one: "Alerts · {count} group", other: "Alerts · {count} groups" },
  "inc2.card.statusPage": "Status page",
  "inc2.card.followUps": { one: "Follow-ups · {count}", other: "Follow-ups · {count}" },
  "inc2.meta.detectedBy": "Detected by",
  "inc2.meta.tta": "Time to ack",
  "inc2.meta.ttr": "Time to resolve",
  "inc2.meta.declared": "Declared",
  "inc2.svc.owner": "owner {team}",
  "inc2.svc.noOwner": "no owner",
  "inc2.svc.none": "No service named for this incident yet.",
  "inc2.alerts.none": "No alert attached.",
  "inc2.alerts.resolved": "resolved",
  "inc2.alerts.firing": "firing",
  "inc2.followUps.none": "No follow-up yet.",
  "inc2.postMortemLink": "Post-mortem →",

  /* ---------- Detail — Atlas ---------- */
  "inc2.atlas.summary": "Summary",
  "inc2.atlas.useAsUpdate": "Use as update",
  "inc2.atlas.events": { one: "timeline · {count} event", other: "timeline · {count} events" },
  "inc2.atlas.alertsChip": { one: "{count} alert", other: "{count} alerts" },
  "inc2.atlas.changesChip": { one: "{count} change", other: "{count} changes" },
  "inc2.atlas.similar": "Similar incidents",
  "inc2.atlas.similarHint": "same service or same wording",
  "inc2.atlas.changes": "Changes around this incident",
  "inc2.atlas.changesHint": "from POST /api/v1/change-events and the deploy hooks",
  "inc2.atlas.note":
    "Every output here is a draft and says where it comes from. The full analysis lives in its own tab.",
  "inc2.atlas.suggested": "Suggested follow-ups",

  /* ---------- Detail — root cause analysis ---------- */
  "inc2.rca.hypothesis": "Hypothesis {id}",
  "inc2.rca.confidence": "confidence {level}",
  "inc2.rca.gradeAfter": "grade after closure: {grade}",
  "inc2.rca.at": "investigation · {when}",
  "inc2.rca.accept": "Accept — write to the post-mortem",
  "inc2.rca.anotherPass": "Ask for another pass",
  "inc2.rca.contest": "Contest — give a reason",
  "inc2.rca.accepted": "Written into the post-mortem › Root cause, with its citations.",
  "inc2.rca.findingsHint": "each one cites where it comes from",
  "inc2.rca.from": "from {source}",
  "inc2.rca.open": "open",
  "inc2.rca.challenger": "Challenger pass",
  "inc2.rca.noObjection": "no objection",
  "inc2.rca.objections": { one: "{count} objection", other: "{count} objections" },
  "inc2.rca.challengerNone":
    "The adversarial pass raised nothing against the surviving hypotheses.",
  "inc2.rca.howToRead": "How to read this",
  "inc2.rca.findingsAgree": {
    one: "{level} · {count} finding agrees",
    other: "{level} · {count} findings agree",
  },
  "inc2.rca.rejectedCount": {
    one: "{count} alternative set aside",
    other: "{count} alternatives set aside",
  },
  "inc2.rca.notGraded": "not graded yet",
  "inc2.rca.gradeNote":
    "The grade is given after closure, from what actually fixed the incident. Nothing is trained on your data.",
  "inc2.rca.rejected": "Set-aside hypotheses",
  "inc2.rca.footer":
    "Nothing here is published on its own. Accepting writes the hypothesis and its citations into the post-mortem, where a person edits and publishes.",

  /* ---------- Detail — context ---------- */
  "inc2.ctx.lead":
    "What the workspace knows about this incident. Every line says where it comes from.",
  "inc2.ctx.unavailable": "Unavailable on this instance — no AI provider configured.",
  "inc2.ctx.configure": "Configure in Settings › AI governance",
  "inc2.ctx.inference": "inference",
  "inc2.ctx.none": "Nothing recorded.",
  "inc2.ctx.from": "from {source} · {when}",
  "inc2.ctx.serviceOwner": "Service & owner",
  "inc2.ctx.onCall": "On call now",
  "inc2.ctx.onCallUntil": "{name} · {schedule} · until {until}",
  "inc2.ctx.onCallNobody": "{schedule} · nobody on call",
  "inc2.ctx.monitors": "Monitors & state",
  "inc2.ctx.monitorState": "{name} · {state}",
  "inc2.ctx.changes": "Changes · 24 h",
  "inc2.ctx.runbooks": "Runbooks",
  "inc2.ctx.similar": "Similar incidents",
  "inc2.ctx.rootCause": "Root cause (RCA)",
  "inc2.ctx.pinned": "Pinned notes",
  "inc2.ctx.servicePolicy": "{service} → owner {team}",
  "inc2.ctx.serviceNoOwner": "{service} → no owner yet",

  /* ---------- Detail — post-incident ---------- */
  "inc2.pi.phase.documenting": "Documenting",
  "inc2.pi.phase.reviewing": "Reviewing",
  "inc2.pi.tasks": "Post-incident tasks · {done}/{total}",
  "inc2.pi.share": "Share",
  "inc2.pi.linkCopied": "Link copied",
  "inc2.pi.comments": "Comments",
  "inc2.pi.teamOnly": "team only",
  "inc2.pi.commentsNote":
    "Comments stay with the incident. They never appear on the status page or in the exported document.",
  "inc2.pi.commentsOn": "on « {section} »",
  "inc2.pi.publish": "Publish the post-mortem",
  "inc2.pi.sendToReview": "Send to review",
  "inc2.pi.footer":
    "Every section stays editable · comments are visible to the team, not on the published page.",
  "inc2.pi.editedBy": { one: "edited by {count} person", other: "edited by {count} people" },

  /* ---------- Share an update ---------- */
  "inc2.upd.drawerLabel": "Share an update",
  "inc2.upd.status": "Status",
  "inc2.upd.sendTo": "Send to",
  "inc2.upd.subscribers": "The incident's subscribers",
  "inc2.upd.always": "always",
  "inc2.upd.draftTag": "draft · Atlas — from the timeline · edit before publishing",

  /* ---------- Declare ---------- */
  "inc2.decl.what": "What is happening?",
  "inc2.decl.service": "Service",
  "inc2.decl.serviceNone": "No service",
  "inc2.decl.serviceEmpty":
    "No service is known yet — they appear as soon as an alert or a monitor names one.",
  "inc2.decl.line": "Type {type} · lead: you · the owner of the service is paged by its policy.",
  "inc2.decl.submit": "Declare",
  "inc2.decl.join": "Join it instead?",
} satisfies Record<string, Message>;

const fr: typeof en = {
  /* ---------- Liste ---------- */
  "inc2.title": "Incidents",
  "inc2.tab.open": "Ouverts",
  "inc2.tab.triage": "Triage",
  "inc2.tab.post": "Post-incident",
  "inc2.tab.all": "Tous",
  "inc2.tabsLabel": "Vues",
  "inc2.declare": "Déclarer un incident",
  "inc2.empty": "Rien dans cette vue.",
  "inc2.emptySearch": "Aucun incident ne correspond à « {q} ».",
  "inc2.searchResults": "Résultats pour « {q} »",
  "inc2.searchClear": "Effacer",
  "inc2.allNote":
    "Ouverts, en triage, en post-incident, et clos depuis moins de sept jours. Les plus anciens sont dans les rapports.",
  "inc2.unassigned": "Non assigné",
  "inc2.listLabel": "Incidents",

  /* ---------- Détail — en-tête ---------- */
  "inc2.back": "Incidents",
  "inc2.window": "{start} → {end} · {duration}",
  "inc2.ongoing": "depuis {start} · {duration}",
  "inc2.publish": "Publier",
  "inc2.resolve": "Déclarer résolu",
  "inc2.dtab.timeline": "Chronologie",
  "inc2.dtab.atlas": "Atlas",
  "inc2.dtab.rca": "Analyse de cause racine",
  "inc2.dtab.context": "Contexte",
  "inc2.dtab.post": "Post-incident",

  /* ---------- Détail — chronologie ---------- */
  "inc2.tl.live": "en direct",
  "inc2.tl.notePlaceholder": "Ajouter une note…",
  "inc2.tl.notePost": "Publier",
  "inc2.tl.empty": "Aucun évènement pour l'instant.",

  /* ---------- Détail — cartes latérales ---------- */
  "inc2.card.services": "Services",
  "inc2.card.alerts": "Alertes",
  "inc2.card.alertGroups": {
    one: "Alertes · {count} groupe",
    other: "Alertes · {count} groupes",
  },
  "inc2.card.statusPage": "Page de statut",
  "inc2.card.followUps": { one: "Suites · {count}", other: "Suites · {count}" },
  "inc2.meta.detectedBy": "Détecté par",
  "inc2.meta.tta": "Délai d'acquittement",
  "inc2.meta.ttr": "Délai de résolution",
  "inc2.meta.declared": "Déclaré",
  "inc2.svc.owner": "responsable {team}",
  "inc2.svc.noOwner": "sans responsable",
  "inc2.svc.none": "Aucun service nommé pour cet incident.",
  "inc2.alerts.none": "Aucune alerte rattachée.",
  "inc2.alerts.resolved": "résolues",
  "inc2.alerts.firing": "en cours",
  "inc2.followUps.none": "Aucune suite pour l'instant.",
  "inc2.postMortemLink": "Post-mortem →",

  /* ---------- Détail — Atlas ---------- */
  "inc2.atlas.summary": "Résumé",
  "inc2.atlas.useAsUpdate": "Utiliser comme mise à jour",
  "inc2.atlas.events": {
    one: "chronologie · {count} évènement",
    other: "chronologie · {count} évènements",
  },
  "inc2.atlas.alertsChip": { one: "{count} alerte", other: "{count} alertes" },
  "inc2.atlas.changesChip": { one: "{count} changement", other: "{count} changements" },
  "inc2.atlas.similar": "Incidents similaires",
  "inc2.atlas.similarHint": "même service ou même formulation",
  "inc2.atlas.changes": "Changements autour de cet incident",
  "inc2.atlas.changesHint": "depuis POST /api/v1/change-events et les hooks de déploiement",
  "inc2.atlas.note":
    "Tout ce qui est produit ici est un brouillon et dit d'où il vient. L'analyse complète a son propre onglet.",
  "inc2.atlas.suggested": "Suites suggérées",

  /* ---------- Détail — analyse de cause racine ---------- */
  "inc2.rca.hypothesis": "Hypothèse {id}",
  "inc2.rca.confidence": "confiance {level}",
  "inc2.rca.gradeAfter": "note après clôture : {grade}",
  "inc2.rca.at": "investigation · {when}",
  "inc2.rca.accept": "Accepter — écrire dans le post-mortem",
  "inc2.rca.anotherPass": "Demander une nouvelle passe",
  "inc2.rca.contest": "Contester — donner une raison",
  "inc2.rca.accepted": "Écrite dans le post-mortem › Cause racine, avec ses citations.",
  "inc2.rca.findingsHint": "chacun cite sa source",
  "inc2.rca.from": "depuis {source}",
  "inc2.rca.open": "ouvrir",
  "inc2.rca.challenger": "Passe contradictoire",
  "inc2.rca.noObjection": "aucune objection",
  "inc2.rca.objections": { one: "{count} objection", other: "{count} objections" },
  "inc2.rca.challengerNone":
    "La passe contradictoire n'a rien opposé aux hypothèses qui subsistent.",
  "inc2.rca.howToRead": "Comment lire ceci",
  "inc2.rca.findingsAgree": {
    one: "{level} · {count} constat concordant",
    other: "{level} · {count} constats concordants",
  },
  "inc2.rca.rejectedCount": {
    one: "{count} alternative écartée",
    other: "{count} alternatives écartées",
  },
  "inc2.rca.notGraded": "pas encore notée",
  "inc2.rca.gradeNote":
    "La note est donnée après clôture, à partir de ce qui a réellement corrigé l'incident. Rien n'est entraîné sur vos données.",
  "inc2.rca.rejected": "Hypothèses écartées",
  "inc2.rca.footer":
    "Rien ici n'est publié de soi-même. Accepter écrit l'hypothèse et ses citations dans le post-mortem, où une personne édite et publie.",

  /* ---------- Détail — contexte ---------- */
  "inc2.ctx.lead":
    "Ce que l'espace de travail sait de cet incident. Chaque ligne dit d'où elle vient.",
  "inc2.ctx.unavailable": "Indisponible sur cette instance — aucun fournisseur d'IA configuré.",
  "inc2.ctx.configure": "Configurer dans Réglages › Gouvernance IA",
  "inc2.ctx.inference": "inférence",
  "inc2.ctx.none": "Rien d'enregistré.",
  "inc2.ctx.from": "depuis {source} · {when}",
  "inc2.ctx.serviceOwner": "Service et responsable",
  "inc2.ctx.onCall": "D'astreinte maintenant",
  "inc2.ctx.onCallUntil": "{name} · {schedule} · jusqu'à {until}",
  "inc2.ctx.onCallNobody": "{schedule} · personne d'astreinte",
  "inc2.ctx.monitors": "Sondes et état",
  "inc2.ctx.monitorState": "{name} · {state}",
  "inc2.ctx.changes": "Changements · 24 h",
  "inc2.ctx.runbooks": "Runbooks",
  "inc2.ctx.similar": "Incidents similaires",
  "inc2.ctx.rootCause": "Cause racine (RCA)",
  "inc2.ctx.pinned": "Notes épinglées",
  "inc2.ctx.servicePolicy": "{service} → responsable {team}",
  "inc2.ctx.serviceNoOwner": "{service} → sans responsable",

  /* ---------- Détail — post-incident ---------- */
  "inc2.pi.phase.documenting": "Documentation",
  "inc2.pi.phase.reviewing": "Revue",
  "inc2.pi.tasks": "Tâches post-incident · {done}/{total}",
  "inc2.pi.share": "Partager",
  "inc2.pi.linkCopied": "Lien copié",
  "inc2.pi.comments": "Commentaires",
  "inc2.pi.teamOnly": "équipe seulement",
  "inc2.pi.commentsNote":
    "Les commentaires restent avec l'incident. Ils n'apparaissent jamais sur la page de statut ni dans le document exporté.",
  "inc2.pi.commentsOn": "sur « {section} »",
  "inc2.pi.publish": "Publier le post-mortem",
  "inc2.pi.sendToReview": "Envoyer en revue",
  "inc2.pi.footer":
    "Chaque section reste éditable · les commentaires sont visibles de l'équipe, pas sur la page publiée.",
  "inc2.pi.editedBy": {
    one: "édité par {count} personne",
    other: "édité par {count} personnes",
  },

  /* ---------- Partager une mise à jour ---------- */
  "inc2.upd.drawerLabel": "Partager une mise à jour",
  "inc2.upd.status": "Statut",
  "inc2.upd.sendTo": "Envoyer à",
  "inc2.upd.subscribers": "Les abonnés de l'incident",
  "inc2.upd.always": "toujours",
  "inc2.upd.draftTag": "brouillon · Atlas — depuis la chronologie · relisez avant de publier",

  /* ---------- Déclaration ---------- */
  "inc2.decl.what": "Que se passe-t-il ?",
  "inc2.decl.service": "Service",
  "inc2.decl.serviceNone": "Aucun service",
  "inc2.decl.serviceEmpty":
    "Aucun service connu pour l'instant — ils apparaissent dès qu'une alerte ou une sonde en nomme un.",
  "inc2.decl.line":
    "Type {type} · responsable : vous · le responsable du service est appelé par sa politique.",
  "inc2.decl.submit": "Déclarer",
  "inc2.decl.join": "Le rejoindre plutôt ?",
};

const de: typeof en = {
  /* ---------- Liste ---------- */
  "inc2.title": "Vorfälle",
  "inc2.tab.open": "Offen",
  "inc2.tab.triage": "Sichtung",
  "inc2.tab.post": "Nachbereitung",
  "inc2.tab.all": "Alle",
  "inc2.tabsLabel": "Ansichten",
  "inc2.declare": "Vorfall melden",
  "inc2.empty": "Nichts in dieser Ansicht.",
  "inc2.emptySearch": "Kein Vorfall passt zu „{q}“.",
  "inc2.searchResults": "Treffer für „{q}“",
  "inc2.searchClear": "Zurücksetzen",
  "inc2.allNote":
    "Offen, in Sichtung, in Nachbereitung und in den letzten sieben Tagen geschlossen. Ältere stehen in den Berichten.",
  "inc2.unassigned": "Nicht zugewiesen",
  "inc2.listLabel": "Vorfälle",

  /* ---------- Detail — Kopf ---------- */
  "inc2.back": "Vorfälle",
  "inc2.window": "{start} → {end} · {duration}",
  "inc2.ongoing": "seit {start} · {duration}",
  "inc2.publish": "Veröffentlichen",
  "inc2.resolve": "Als behoben melden",
  "inc2.dtab.timeline": "Verlauf",
  "inc2.dtab.atlas": "Atlas",
  "inc2.dtab.rca": "Ursachenanalyse",
  "inc2.dtab.context": "Kontext",
  "inc2.dtab.post": "Nachbereitung",

  /* ---------- Detail — Verlauf ---------- */
  "inc2.tl.live": "live",
  "inc2.tl.notePlaceholder": "Notiz hinzufügen…",
  "inc2.tl.notePost": "Senden",
  "inc2.tl.empty": "Noch kein Ereignis.",

  /* ---------- Detail — Seitenkarten ---------- */
  "inc2.card.services": "Dienste",
  "inc2.card.alerts": "Alarme",
  "inc2.card.alertGroups": { one: "Alarme · {count} Gruppe", other: "Alarme · {count} Gruppen" },
  "inc2.card.statusPage": "Statusseite",
  "inc2.card.followUps": { one: "Maßnahmen · {count}", other: "Maßnahmen · {count}" },
  "inc2.meta.detectedBy": "Erkannt durch",
  "inc2.meta.tta": "Zeit bis Quittierung",
  "inc2.meta.ttr": "Zeit bis Behebung",
  "inc2.meta.declared": "Gemeldet",
  "inc2.svc.owner": "Eigentümer {team}",
  "inc2.svc.noOwner": "kein Eigentümer",
  "inc2.svc.none": "Für diesen Vorfall ist noch kein Dienst benannt.",
  "inc2.alerts.none": "Kein Alarm verknüpft.",
  "inc2.alerts.resolved": "behoben",
  "inc2.alerts.firing": "aktiv",
  "inc2.followUps.none": "Noch keine Maßnahme.",
  "inc2.postMortemLink": "Post-Mortem →",

  /* ---------- Detail — Atlas ---------- */
  "inc2.atlas.summary": "Zusammenfassung",
  "inc2.atlas.useAsUpdate": "Als Update verwenden",
  "inc2.atlas.events": { one: "Verlauf · {count} Ereignis", other: "Verlauf · {count} Ereignisse" },
  "inc2.atlas.alertsChip": { one: "{count} Alarm", other: "{count} Alarme" },
  "inc2.atlas.changesChip": { one: "{count} Änderung", other: "{count} Änderungen" },
  "inc2.atlas.similar": "Ähnliche Vorfälle",
  "inc2.atlas.similarHint": "gleicher Dienst oder gleicher Wortlaut",
  "inc2.atlas.changes": "Änderungen rund um diesen Vorfall",
  "inc2.atlas.changesHint": "aus POST /api/v1/change-events und den Deploy-Hooks",
  "inc2.atlas.note":
    "Alles hier ist ein Entwurf und nennt seine Quelle. Die vollständige Analyse hat einen eigenen Reiter.",
  "inc2.atlas.suggested": "Vorgeschlagene Maßnahmen",

  /* ---------- Detail — Ursachenanalyse ---------- */
  "inc2.rca.hypothesis": "Hypothese {id}",
  "inc2.rca.confidence": "Zuversicht {level}",
  "inc2.rca.gradeAfter": "Bewertung nach Abschluss: {grade}",
  "inc2.rca.at": "Untersuchung · {when}",
  "inc2.rca.accept": "Annehmen — ins Post-Mortem schreiben",
  "inc2.rca.anotherPass": "Weiteren Durchlauf anfordern",
  "inc2.rca.contest": "Widersprechen — Grund angeben",
  "inc2.rca.accepted": "In das Post-Mortem › Ursache geschrieben, mit den Belegen.",
  "inc2.rca.findingsHint": "jeder nennt seine Quelle",
  "inc2.rca.from": "aus {source}",
  "inc2.rca.open": "öffnen",
  "inc2.rca.challenger": "Gegenprüfung",
  "inc2.rca.noObjection": "kein Einwand",
  "inc2.rca.objections": { one: "{count} Einwand", other: "{count} Einwände" },
  "inc2.rca.challengerNone":
    "Die Gegenprüfung hat den verbliebenen Hypothesen nichts entgegengesetzt.",
  "inc2.rca.howToRead": "So ist das zu lesen",
  "inc2.rca.findingsAgree": {
    one: "{level} · {count} Befund stützt sie",
    other: "{level} · {count} Befunde stützen sie",
  },
  "inc2.rca.rejectedCount": {
    one: "{count} Alternative verworfen",
    other: "{count} Alternativen verworfen",
  },
  "inc2.rca.notGraded": "noch nicht bewertet",
  "inc2.rca.gradeNote":
    "Die Bewertung erfolgt nach Abschluss, ausgehend davon, was den Vorfall tatsächlich behoben hat. Mit Ihren Daten wird nichts trainiert.",
  "inc2.rca.rejected": "Verworfene Hypothesen",
  "inc2.rca.footer":
    "Nichts hiervon wird von selbst veröffentlicht. Annehmen schreibt die Hypothese samt Belegen ins Post-Mortem, wo ein Mensch redigiert und veröffentlicht.",

  /* ---------- Detail — Kontext ---------- */
  "inc2.ctx.lead": "Was der Arbeitsbereich über diesen Vorfall weiß. Jede Zeile nennt ihre Quelle.",
  "inc2.ctx.unavailable": "Auf dieser Instanz nicht verfügbar — kein KI-Anbieter konfiguriert.",
  "inc2.ctx.configure": "In Einstellungen › KI-Governance konfigurieren",
  "inc2.ctx.inference": "Inferenz",
  "inc2.ctx.none": "Nichts erfasst.",
  "inc2.ctx.from": "aus {source} · {when}",
  "inc2.ctx.serviceOwner": "Dienst & Eigentümer",
  "inc2.ctx.onCall": "Jetzt in Bereitschaft",
  "inc2.ctx.onCallUntil": "{name} · {schedule} · bis {until}",
  "inc2.ctx.onCallNobody": "{schedule} · niemand in Bereitschaft",
  "inc2.ctx.monitors": "Sonden & Zustand",
  "inc2.ctx.monitorState": "{name} · {state}",
  "inc2.ctx.changes": "Änderungen · 24 h",
  "inc2.ctx.runbooks": "Runbooks",
  "inc2.ctx.similar": "Ähnliche Vorfälle",
  "inc2.ctx.rootCause": "Ursache (RCA)",
  "inc2.ctx.pinned": "Angeheftete Notizen",
  "inc2.ctx.servicePolicy": "{service} → Eigentümer {team}",
  "inc2.ctx.serviceNoOwner": "{service} → noch kein Eigentümer",

  /* ---------- Detail — Nachbereitung ---------- */
  "inc2.pi.phase.documenting": "Dokumentieren",
  "inc2.pi.phase.reviewing": "Prüfen",
  "inc2.pi.tasks": "Aufgaben der Nachbereitung · {done}/{total}",
  "inc2.pi.share": "Teilen",
  "inc2.pi.linkCopied": "Link kopiert",
  "inc2.pi.comments": "Kommentare",
  "inc2.pi.teamOnly": "nur Team",
  "inc2.pi.commentsNote":
    "Kommentare bleiben beim Vorfall. Sie erscheinen nie auf der Statusseite oder im exportierten Dokument.",
  "inc2.pi.commentsOn": "zu « {section} »",
  "inc2.pi.publish": "Post-Mortem veröffentlichen",
  "inc2.pi.sendToReview": "Zur Prüfung geben",
  "inc2.pi.footer":
    "Jeder Abschnitt bleibt editierbar · Kommentare sieht das Team, nicht die veröffentlichte Seite.",
  "inc2.pi.editedBy": {
    one: "von {count} Person bearbeitet",
    other: "von {count} Personen bearbeitet",
  },

  /* ---------- Update teilen ---------- */
  "inc2.upd.drawerLabel": "Ein Update teilen",
  "inc2.upd.status": "Status",
  "inc2.upd.sendTo": "Senden an",
  "inc2.upd.subscribers": "Die Abonnenten des Vorfalls",
  "inc2.upd.always": "immer",
  "inc2.upd.draftTag": "Entwurf · Atlas — aus dem Verlauf · vor dem Senden prüfen",

  /* ---------- Meldung ---------- */
  "inc2.decl.what": "Was passiert gerade?",
  "inc2.decl.service": "Dienst",
  "inc2.decl.serviceNone": "Kein Dienst",
  "inc2.decl.serviceEmpty":
    "Noch kein Dienst bekannt — sie erscheinen, sobald ein Alarm oder eine Sonde einen nennt.",
  "inc2.decl.line":
    "Typ {type} · Leitung: Sie · der Eigentümer des Dienstes wird über seine Richtlinie alarmiert.",
  "inc2.decl.submit": "Melden",
  "inc2.decl.join": "Stattdessen beitreten?",
};

export const incidentsPart = { en, fr, de };
