/**
 * Labels of the settings screens, in the three languages.
 *
 * Each language holds exactly the same keys — English is the source the
 * `Dictionary` type derives from, so a gap in another language does not
 * compile.
 *
 * The `set2.` prefix marks the V2 wording: the keys the rebuilt settings area
 * needs and the older `settings.*` block does not already carry. Anything that
 * already reads right in `en.ts` is reused rather than restated here.
 */
import type { Message } from "../../dictionary";

const en = {
  /* ---------- Navigation ---------- */
  "set2.nav.rules": "Rules",
  "set2.nav.alertSeverities": "Alert severities",
  "set2.nav.incidentSeverities": "Incident severities",
  "set2.nav.probes": "Probes",
  "set2.nav.fields": "Fields & labels",
  "set2.nav.postIncident": "Post-incident & post-mortem",
  "set2.nav.externalHint": "Opens the Alerts section",
  "set2.nav.billingOff": "cloud only",
  "set2.nav.billingWhy":
    "Subscriptions are sold and billed by the Open Incident cloud control plane. This instance runs self-hosted, so there is nothing to bill: the screen answers 404. Start the instance with OPENINCIDENT_EDITION=cloud and a reachable control plane to enable it.",

  /* ---------- Rules ---------- */
  "set2.rules.title": "Rules",
  "set2.rules.subtitle": "exceptions to what your sources already decide",
  "set2.rules.new": "+ New rule",
  "set2.rules.firstWins":
    "The first matching rule wins. Without a rule, the source's own three choices apply.",
  "set2.rules.empty":
    "No rule yet — every alert follows the three choices of the source it came from.",
  "set2.rules.matched": { one: "matched {count} · 90 d", other: "matched {count} · 90 d" },
  "set2.rules.defaultsChip": "default",
  "set2.rules.defaultsHint":
    "No condition — it catches everything it sees, so it is a default rather than an exception. A rule placed below it never runs for those alerts. The three choices a source makes for itself are stored in a row of this shape.",
  "set2.sev.new": "+ New severity",
  "set2.rules.readOnly": "Only an administrator can change the rules.",

  /* ---------- The rule editor ---------- */
  "set2.ed.newTitle": "New rule",
  "set2.ed.editTitle": "Edit rule {n}",
  "set2.ed.if": "If",
  "set2.ed.and": "and",
  "set2.ed.then": "→ then",
  "set2.ed.addCond": "+ and",
  "set2.ed.addAct": "+ then",
  "set2.ed.readsAs": "Reads as: « {sentence} »",
  "set2.ed.chipHint": "Opens the section that owns this choice",
  "set2.ed.everyAlert": "every alert",
  "set2.ed.previewTitle": "Preview on the last {count} alerts",
  "set2.ed.previewMatches": "matches",
  "set2.ed.previewChanges": { one: "changes {count} outcome", other: "changes {count} outcomes" },
  "set2.ed.nothingSent": "nothing is sent",
  "set2.ed.previewEmpty": "No alert received yet — there is nothing to preview against.",
  "set2.ed.previewRun": "Refresh",
  "set2.ed.previewRunning": "Evaluating…",
  "set2.ed.unchangedFrom": "{before} → unchanged",
  "set2.ed.changedTo": "{before} → would be {after}",
  "set2.ed.noRule": "no rule — the source's own choices",
  "set2.ed.outcomePages": "pages {paths}",
  "set2.ed.outcomeNobody": "pages nobody",
  "set2.ed.outcomeTest": "test mode — logged only",
  "set2.ed.startTest": "Start in test mode — log only, don't act",
  "set2.ed.save": "Save rule",
  "set2.ed.detail": "All the choices",
  "set2.ed.detailHint": "The chips above summarise this draft; everything is edited below.",

  /* ---------- Alert severities ---------- */
  "set2.sev.title": "Alert severities",
  "set2.sev.subtitle":
    "P1 and P2 wake people up. P3 and P4 wait for working hours. The mapping to incident severity is a default — change it when promoting.",
  "set2.sev.wakes": "wakes people up",
  "set2.sev.waits": "waits for working hours",
  "set2.sev.opensAs": "opens as {severity}",
  "set2.sev.opensAsNone": "no incident severity at this rank",
  "set2.sev.mappingNote":
    "The incident severity is read off the rank: the first alert severity opens the first incident severity, and so on down both lists — the last one catches the rest. It is a default; a rule can fix the severity instead, and a responder can change it when promoting.",
  "set2.sev.alsoCalled":
    "The API, the payload mappings and the rule editor call these priorities. Same rows, older word.",
  "set2.sev.empty": "No alert severity yet.",

  /* ---------- AI governance ---------- */
  "set2.ai.mayDo": "What Atlas may do",
  "set2.ai.chipConfigured": "INFERENCE · {host}",
  "set2.ai.chipNone": "NO PROVIDER",
  "set2.ai.regionNote":
    "The product calls one OpenAI-compatible endpoint and does not know where it runs: the region is a property of the endpoint the operator configured, not something this screen can verify. Point AI_API_BASE at an EU deployment to keep inference in the EU.",
  "set2.ai.retention":
    "Retention and training are governed by the contract with that endpoint — the product cannot enforce them. What it does enforce: secrets are redacted before any prompt, and private incidents never feed the knowledge layer unless you opt in below.",

  /* ---------- Probes ---------- */
  "set2.probes.title": "Probes",
  "set2.probes.subtitle": "where the monitor checks are made from",
  "set2.probes.none": "No probe is registered.",
  "set2.probes.noRunner":
    "Nothing in the product dispatches a check to a probe yet. Every monitor is checked by this instance's own worker, from whatever network that worker runs on. The table below is the registry the feature will use; it stays empty until probes ship.",
  "set2.probes.whereChecksRun": "Where checks run from today",
  "set2.probes.workerLine":
    "The worker process of this instance. A target on a private network is reachable only if the worker can reach it.",
  "set2.probes.lastSweep": "Last monitor check {when}",
  "set2.probes.neverSwept": "No monitor has been checked yet.",
  "set2.probes.activeMonitors": {
    one: "{count} monitor being checked",
    other: "{count} monitors being checked",
  },
  "set2.probes.noMonitors": "No monitor is active.",
  "set2.probes.registry": "Probe registry",
  "set2.probes.col.name": "Name",
  "set2.probes.col.region": "Region",
  "set2.probes.col.owner": "Owner",
  "set2.probes.col.lastSeen": "Last report",
  "set2.probes.col.version": "Version",
  "set2.probes.ownerInstance": "instance",
  "set2.probes.ownerWorkspace": "this workspace",
  "set2.probes.neverReported": "never reported",
  "set2.probes.openMonitors": "Open Monitors →",
} satisfies Record<string, Message>;

const fr = {
  /* ---------- Navigation ---------- */
  "set2.nav.rules": "Règles",
  "set2.nav.alertSeverities": "Sévérités d'alerte",
  "set2.nav.incidentSeverities": "Sévérités d'incident",
  "set2.nav.probes": "Sondes",
  "set2.nav.fields": "Champs et libellés",
  "set2.nav.postIncident": "Post-incident et post-mortem",
  "set2.nav.externalHint": "Ouvre la section Alertes",
  "set2.nav.billingOff": "cloud uniquement",
  "set2.nav.billingWhy":
    "Les abonnements sont vendus et facturés par le plan de contrôle cloud d'Open Incident. Cette instance est auto-hébergée : il n'y a rien à facturer, l'écran répond 404. Démarrez l'instance avec OPENINCIDENT_EDITION=cloud et un plan de contrôle joignable pour l'activer.",

  /* ---------- Règles ---------- */
  "set2.rules.title": "Règles",
  "set2.rules.subtitle": "les exceptions à ce que vos sources décident déjà",
  "set2.rules.new": "+ Nouvelle règle",
  "set2.rules.firstWins":
    "La première règle qui correspond l'emporte. Sans règle, les trois choix de la source s'appliquent.",
  "set2.rules.empty":
    "Aucune règle — chaque alerte suit les trois choix de la source d'où elle vient.",
  "set2.rules.matched": {
    one: "{count} correspondance · 90 j",
    other: "{count} correspondances · 90 j",
  },
  "set2.rules.defaultsChip": "défaut",
  "set2.rules.defaultsHint":
    "Aucune condition — elle attrape tout ce qu'elle voit : c'est un défaut, pas une exception. Une règle placée en dessous ne s'exécutera jamais pour ces alertes. Les trois choix qu'une source fait pour elle-même sont stockés dans une ligne de cette forme.",
  "set2.sev.new": "+ Nouvelle sévérité",
  "set2.rules.readOnly": "Seul un administrateur peut modifier les règles.",

  /* ---------- L'éditeur de règle ---------- */
  "set2.ed.newTitle": "Nouvelle règle",
  "set2.ed.editTitle": "Modifier la règle {n}",
  "set2.ed.if": "Si",
  "set2.ed.and": "et",
  "set2.ed.then": "→ alors",
  "set2.ed.addCond": "+ et",
  "set2.ed.addAct": "+ alors",
  "set2.ed.readsAs": "Se lit : « {sentence} »",
  "set2.ed.chipHint": "Ouvre la section qui porte ce choix",
  "set2.ed.everyAlert": "toute alerte",
  "set2.ed.previewTitle": "Aperçu sur les {count} dernières alertes",
  "set2.ed.previewMatches": "correspond à",
  "set2.ed.previewChanges": { one: "change {count} issue", other: "change {count} issues" },
  "set2.ed.nothingSent": "rien n'est envoyé",
  "set2.ed.previewEmpty": "Aucune alerte reçue — il n'y a rien à évaluer.",
  "set2.ed.previewRun": "Rafraîchir",
  "set2.ed.previewRunning": "Évaluation…",
  "set2.ed.unchangedFrom": "{before} → inchangé",
  "set2.ed.changedTo": "{before} → deviendrait {after}",
  "set2.ed.noRule": "aucune règle — les choix de la source",
  "set2.ed.outcomePages": "alerte {paths}",
  "set2.ed.outcomeNobody": "n'alerte personne",
  "set2.ed.outcomeTest": "mode test — journalisé seulement",
  "set2.ed.startTest": "Démarrer en mode test — journaliser sans agir",
  "set2.ed.save": "Enregistrer la règle",
  "set2.ed.detail": "Tous les choix",
  "set2.ed.detailHint":
    "Les pastilles ci-dessus résument ce brouillon ; tout se modifie ci-dessous.",

  /* ---------- Sévérités d'alerte ---------- */
  "set2.sev.title": "Sévérités d'alerte",
  "set2.sev.subtitle":
    "P1 et P2 réveillent. P3 et P4 attendent les heures ouvrées. La correspondance vers la sévérité d'incident est un défaut — changez-la à la promotion.",
  "set2.sev.wakes": "réveille",
  "set2.sev.waits": "attend les heures ouvrées",
  "set2.sev.opensAs": "ouvre en {severity}",
  "set2.sev.opensAsNone": "aucune sévérité d'incident à ce rang",
  "set2.sev.mappingNote":
    "La sévérité d'incident se lit sur le rang : la première sévérité d'alerte ouvre la première sévérité d'incident, et ainsi de suite dans les deux listes — la dernière ramasse le reste. C'est un défaut ; une règle peut fixer la sévérité, et un intervenant peut la changer à la promotion.",
  "set2.sev.alsoCalled":
    "L'API, les mappages de charge utile et l'éditeur de règles appellent ceci des priorités. Mêmes lignes, mot plus ancien.",
  "set2.sev.empty": "Aucune sévérité d'alerte.",

  /* ---------- Gouvernance IA ---------- */
  "set2.ai.mayDo": "Ce qu'Atlas a le droit de faire",
  "set2.ai.chipConfigured": "INFÉRENCE · {host}",
  "set2.ai.chipNone": "AUCUN FOURNISSEUR",
  "set2.ai.regionNote":
    "Le produit appelle un point d'accès compatible OpenAI et ignore où il tourne : la région est une propriété du point d'accès configuré par l'exploitant, pas quelque chose que cet écran peut vérifier. Pointez AI_API_BASE vers un déploiement européen pour garder l'inférence en Europe.",
  "set2.ai.retention":
    "La rétention et l'entraînement relèvent du contrat passé avec ce point d'accès — le produit ne peut pas les imposer. Ce qu'il impose : les secrets sont expurgés avant tout prompt, et les incidents privés n'alimentent jamais la couche de connaissance sans votre accord ci-dessous.",

  /* ---------- Sondes ---------- */
  "set2.probes.title": "Sondes",
  "set2.probes.subtitle": "d'où partent les vérifications des moniteurs",
  "set2.probes.none": "Aucune sonde enregistrée.",
  "set2.probes.noRunner":
    "Rien dans le produit ne confie encore une vérification à une sonde. Chaque moniteur est vérifié par le worker de cette instance, depuis le réseau où ce worker tourne. Le tableau ci-dessous est le registre que la fonctionnalité utilisera ; il reste vide tant que les sondes ne sont pas livrées.",
  "set2.probes.whereChecksRun": "D'où partent les vérifications aujourd'hui",
  "set2.probes.workerLine":
    "Le processus worker de cette instance. Une cible sur un réseau privé n'est joignable que si le worker peut l'atteindre.",
  "set2.probes.lastSweep": "Dernière vérification {when}",
  "set2.probes.neverSwept": "Aucun moniteur n'a encore été vérifié.",
  "set2.probes.activeMonitors": {
    one: "{count} moniteur vérifié",
    other: "{count} moniteurs vérifiés",
  },
  "set2.probes.noMonitors": "Aucun moniteur actif.",
  "set2.probes.registry": "Registre des sondes",
  "set2.probes.col.name": "Nom",
  "set2.probes.col.region": "Région",
  "set2.probes.col.owner": "Propriétaire",
  "set2.probes.col.lastSeen": "Dernier rapport",
  "set2.probes.col.version": "Version",
  "set2.probes.ownerInstance": "instance",
  "set2.probes.ownerWorkspace": "cet espace",
  "set2.probes.neverReported": "jamais rapporté",
  "set2.probes.openMonitors": "Ouvrir les moniteurs →",
} satisfies Record<keyof typeof en, Message>;

const de = {
  /* ---------- Navigation ---------- */
  "set2.nav.rules": "Regeln",
  "set2.nav.alertSeverities": "Alarm-Schweregrade",
  "set2.nav.incidentSeverities": "Vorfall-Schweregrade",
  "set2.nav.probes": "Prüfpunkte",
  "set2.nav.fields": "Felder & Labels",
  "set2.nav.postIncident": "Nachbereitung & Post-Mortem",
  "set2.nav.externalHint": "Öffnet den Bereich Alarme",
  "set2.nav.billingOff": "nur Cloud",
  "set2.nav.billingWhy":
    "Abonnements werden von der Open-Incident-Cloud-Steuerebene verkauft und abgerechnet. Diese Instanz läuft selbst gehostet, es gibt also nichts abzurechnen: Der Bildschirm antwortet mit 404. Starten Sie die Instanz mit OPENINCIDENT_EDITION=cloud und einer erreichbaren Steuerebene, um ihn zu aktivieren.",

  /* ---------- Regeln ---------- */
  "set2.rules.title": "Regeln",
  "set2.rules.subtitle": "Ausnahmen von dem, was Ihre Quellen bereits entscheiden",
  "set2.rules.new": "+ Neue Regel",
  "set2.rules.firstWins":
    "Die erste passende Regel gewinnt. Ohne Regel gelten die drei Entscheidungen der Quelle selbst.",
  "set2.rules.empty": "Noch keine Regel — jeder Alarm folgt den drei Entscheidungen seiner Quelle.",
  "set2.rules.matched": { one: "{count} Treffer · 90 T", other: "{count} Treffer · 90 T" },
  "set2.rules.defaultsChip": "Standard",
  "set2.rules.defaultsHint":
    "Keine Bedingung — sie fängt alles, was sie sieht: eine Vorgabe, keine Ausnahme. Eine darunter platzierte Regel läuft für diese Alarme nie. Die drei Entscheidungen, die eine Quelle für sich selbst trifft, liegen in einer Zeile dieser Form.",
  "set2.sev.new": "+ Neuer Schweregrad",
  "set2.rules.readOnly": "Nur eine Administratorin kann die Regeln ändern.",

  /* ---------- Der Regeleditor ---------- */
  "set2.ed.newTitle": "Neue Regel",
  "set2.ed.editTitle": "Regel {n} bearbeiten",
  "set2.ed.if": "Wenn",
  "set2.ed.and": "und",
  "set2.ed.then": "→ dann",
  "set2.ed.addCond": "+ und",
  "set2.ed.addAct": "+ dann",
  "set2.ed.readsAs": "Liest sich als: « {sentence} »",
  "set2.ed.chipHint": "Öffnet den Abschnitt, der diese Entscheidung trägt",
  "set2.ed.everyAlert": "jeder Alarm",
  "set2.ed.previewTitle": "Vorschau auf die letzten {count} Alarme",
  "set2.ed.previewMatches": "trifft auf",
  "set2.ed.previewChanges": { one: "ändert {count} Ergebnis", other: "ändert {count} Ergebnisse" },
  "set2.ed.nothingSent": "nichts wird gesendet",
  "set2.ed.previewEmpty": "Noch kein Alarm empfangen — es gibt nichts auszuwerten.",
  "set2.ed.previewRun": "Aktualisieren",
  "set2.ed.previewRunning": "Wird ausgewertet…",
  "set2.ed.unchangedFrom": "{before} → unverändert",
  "set2.ed.changedTo": "{before} → würde {after}",
  "set2.ed.noRule": "keine Regel — die Entscheidungen der Quelle",
  "set2.ed.outcomePages": "alarmiert {paths}",
  "set2.ed.outcomeNobody": "alarmiert niemanden",
  "set2.ed.outcomeTest": "Testmodus — nur protokolliert",
  "set2.ed.startTest": "Im Testmodus starten — nur protokollieren, nicht handeln",
  "set2.ed.save": "Regel speichern",
  "set2.ed.detail": "Alle Entscheidungen",
  "set2.ed.detailHint":
    "Die Chips oben fassen diesen Entwurf zusammen; alles wird unten bearbeitet.",

  /* ---------- Alarm-Schweregrade ---------- */
  "set2.sev.title": "Alarm-Schweregrade",
  "set2.sev.subtitle":
    "P1 und P2 wecken Menschen. P3 und P4 warten auf die Arbeitszeit. Die Zuordnung zum Vorfall-Schweregrad ist eine Vorgabe — ändern Sie sie beim Hochstufen.",
  "set2.sev.wakes": "weckt Menschen",
  "set2.sev.waits": "wartet auf die Arbeitszeit",
  "set2.sev.opensAs": "öffnet als {severity}",
  "set2.sev.opensAsNone": "kein Vorfall-Schweregrad auf diesem Rang",
  "set2.sev.mappingNote":
    "Der Vorfall-Schweregrad ergibt sich aus dem Rang: Der erste Alarm-Schweregrad öffnet den ersten Vorfall-Schweregrad, und so weiter durch beide Listen — der letzte fängt den Rest auf. Das ist eine Vorgabe; eine Regel kann den Schweregrad festlegen, und eine Einsatzkraft kann ihn beim Hochstufen ändern.",
  "set2.sev.alsoCalled":
    "Die API, die Payload-Zuordnungen und der Regeleditor nennen dies Prioritäten. Dieselben Zeilen, älteres Wort.",
  "set2.sev.empty": "Noch kein Alarm-Schweregrad.",

  /* ---------- KI-Governance ---------- */
  "set2.ai.mayDo": "Was Atlas tun darf",
  "set2.ai.chipConfigured": "INFERENZ · {host}",
  "set2.ai.chipNone": "KEIN ANBIETER",
  "set2.ai.regionNote":
    "Das Produkt ruft einen OpenAI-kompatiblen Endpunkt auf und weiß nicht, wo er läuft: Die Region ist eine Eigenschaft des vom Betreiber konfigurierten Endpunkts, nichts, was dieser Bildschirm prüfen kann. Richten Sie AI_API_BASE auf eine EU-Bereitstellung, um die Inferenz in der EU zu halten.",
  "set2.ai.retention":
    "Aufbewahrung und Training regelt der Vertrag mit diesem Endpunkt — das Produkt kann sie nicht erzwingen. Was es erzwingt: Geheimnisse werden vor jedem Prompt geschwärzt, und private Vorfälle speisen die Wissensschicht nie, sofern Sie es unten nicht erlauben.",

  /* ---------- Prüfpunkte ---------- */
  "set2.probes.title": "Prüfpunkte",
  "set2.probes.subtitle": "von wo aus die Monitor-Prüfungen laufen",
  "set2.probes.none": "Kein Prüfpunkt registriert.",
  "set2.probes.noRunner":
    "Nichts im Produkt übergibt bislang eine Prüfung an einen Prüfpunkt. Jeder Monitor wird vom Worker dieser Instanz geprüft, aus dem Netz heraus, in dem dieser Worker läuft. Die Tabelle unten ist das Register, das die Funktion nutzen wird; es bleibt leer, bis Prüfpunkte ausgeliefert sind.",
  "set2.probes.whereChecksRun": "Von wo Prüfungen heute laufen",
  "set2.probes.workerLine":
    "Der Worker-Prozess dieser Instanz. Ein Ziel in einem privaten Netz ist nur erreichbar, wenn der Worker es erreichen kann.",
  "set2.probes.lastSweep": "Letzte Monitor-Prüfung {when}",
  "set2.probes.neverSwept": "Noch kein Monitor wurde geprüft.",
  "set2.probes.activeMonitors": {
    one: "{count} Monitor wird geprüft",
    other: "{count} Monitore werden geprüft",
  },
  "set2.probes.noMonitors": "Kein Monitor ist aktiv.",
  "set2.probes.registry": "Prüfpunkt-Register",
  "set2.probes.col.name": "Name",
  "set2.probes.col.region": "Region",
  "set2.probes.col.owner": "Eigentümer",
  "set2.probes.col.lastSeen": "Letzte Meldung",
  "set2.probes.col.version": "Version",
  "set2.probes.ownerInstance": "Instanz",
  "set2.probes.ownerWorkspace": "dieser Arbeitsbereich",
  "set2.probes.neverReported": "nie gemeldet",
  "set2.probes.openMonitors": "Monitore öffnen →",
} satisfies Record<keyof typeof en, Message>;

export const settingsPart = { en, fr, de } satisfies {
  en: Record<string, Message>;
  fr: Record<keyof typeof en, Message>;
  de: Record<keyof typeof en, Message>;
};
