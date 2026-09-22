/**
 * Labels of the status-pages screens, in the three languages.
 *
 * Each language holds exactly the same keys — English is the source the
 * `Dictionary` type derives from, so a gap in another language does not
 * compile. The `sp2.` prefix is the V2 screen's own vocabulary; the older
 * `statusPages.` keys in `en.ts` stay in use wherever the wording did not move.
 *
 * Note the absence of `as const`: the part is spread into `en.ts`, and a
 * literal type there would force the French and German values to be the
 * English string.
 */
import type { Message } from "../../dictionary";

const en = {
  "sp2.countPublic": { one: "{count} public", other: "{count} public" },
  "sp2.countInternal": { one: "{count} internal", other: "{count} internal" },
  "sp2.visibilityPublic": "public",
  "sp2.visibilityInternal": "internal",
  "sp2.componentsNote": "tracking a monitor = automatic status",
  "sp2.auto": "AUTO",
  "sp2.autoTitle": "Its state, its uptime and its bars are read off the monitor.",
  "sp2.manualSource": "manual · set from incidents",
  "sp2.publicFeed": "Public incidents & maintenances",
  "sp2.subscribersEyebrow": "Subscribers · {count}",
  "sp2.chEmail": "Email",
  "sp2.chFeed": "RSS / Atom",
  "sp2.chWebhook": "Webhook",
  "sp2.chSlack": "Slack channels",
  "sp2.chTeams": "Teams channels",
  "sp2.unavailable": "unavailable",
  "sp2.subscribersNote":
    "Email is double opt-in, one click to unsubscribe. RSS counts reads of the feed, not people. Chat channels are not a subscription channel on this instance.",
  "sp2.internalPage": "Internal page",
  "sp2.publicPage": "Public page",
  "sp2.ssoOnly": "SSO only",
  "sp2.nComponents": { one: "{count} component", other: "{count} components" },
  "sp2.openPage": "Open →",
  "sp2.addComponentTitle": "Add a component",
  "sp2.editComponentTitle": "Edit the component",
  "sp2.editMaintenanceTitle": "Move the maintenance",
  "sp2.maintenanceMoved": "Maintenance updated. Subscribers were not emailed again.",
  "sp2.updateCorrected": "Update corrected. The page says so; nobody was notified again.",
  "sp2.editMaintenanceNote":
    "Only a window that has not started can move. Changing the dates adds one line to the public timeline; rewording the message does not — the page already shows it.",
  "sp2.publicName": "Public name",
  "sp2.descriptionLabel": "One public line",
  "sp2.descriptionHint": "What a visitor needs to recognise the thing",
  "sp2.sourceLabel": "Status comes from",
  "sp2.sourceMonitor": "A monitor",
  "sp2.sourceMonitorHint": "automatic status, uptime over 90 days, 90 days of bars",
  "sp2.sourceManual": "Manual",
  "sp2.sourceManualHint": "you set it from incidents",
  "sp2.monitorLabel": "Monitor",
  "sp2.noMonitors": "No monitor yet — create one under Monitors, or keep the component manual.",
  "sp2.addComponent": "Add component",
  "sp2.trackedNote":
    "A component that tracks a monitor takes its state, its uptime and its bars from it — neither a person nor a published incident overwrites them.",
  "sp2.noData": "no measurement yet",
  "sp2.uptime90Title": "uptime over 90 days",
  "sp2.stateLabel": "Component state",
  "sp2.settings": "Page settings",
};

type Part = Record<keyof typeof en, Message>;

export const statusPagesPart = {
  en,
  fr: {
    "sp2.countPublic": { one: "{count} publique", other: "{count} publiques" },
    "sp2.countInternal": { one: "{count} interne", other: "{count} internes" },
    "sp2.visibilityPublic": "publique",
    "sp2.visibilityInternal": "interne",
    "sp2.componentsNote": "suivre un moniteur = statut automatique",
    "sp2.auto": "AUTO",
    "sp2.autoTitle": "Son état, son uptime et ses barres sont lus sur le moniteur.",
    "sp2.manualSource": "manuel · défini depuis les incidents",
    "sp2.publicFeed": "Incidents publics et maintenances",
    "sp2.subscribersEyebrow": "Abonnés · {count}",
    "sp2.chEmail": "Email",
    "sp2.chFeed": "RSS / Atom",
    "sp2.chWebhook": "Webhook",
    "sp2.chSlack": "Canaux Slack",
    "sp2.chTeams": "Canaux Teams",
    "sp2.unavailable": "indisponible",
    "sp2.subscribersNote":
      "L'email est en double opt-in, désabonnement en un clic. Le RSS compte des lectures du flux, pas des personnes. Les canaux de discussion ne sont pas un canal d'abonnement sur cette instance.",
    "sp2.internalPage": "Page interne",
    "sp2.publicPage": "Page publique",
    "sp2.ssoOnly": "SSO uniquement",
    "sp2.nComponents": { one: "{count} composant", other: "{count} composants" },
    "sp2.openPage": "Ouvrir →",
    "sp2.addComponentTitle": "Ajouter un composant",
    "sp2.editComponentTitle": "Modifier le composant",
    "sp2.editMaintenanceTitle": "Déplacer la maintenance",
    "sp2.maintenanceMoved": "Maintenance mise à jour. Les abonnés n'ont pas été renotifiés.",
    "sp2.updateCorrected": "Mise à jour corrigée. La page le dit ; personne n'a été renotifié.",
    "sp2.editMaintenanceNote":
      "Seule une fenêtre qui n'a pas commencé peut être déplacée. Changer les dates ajoute une ligne à la chronologie publique ; reformuler le message non — la page l'affiche déjà.",
    "sp2.publicName": "Nom public",
    "sp2.descriptionLabel": "Une ligne publique",
    "sp2.descriptionHint": "Ce qu'il faut à un visiteur pour reconnaître la chose",
    "sp2.sourceLabel": "Le statut vient de",
    "sp2.sourceMonitor": "Un moniteur",
    "sp2.sourceMonitorHint": "statut automatique, uptime sur 90 jours, 90 jours de barres",
    "sp2.sourceManual": "Manuel",
    "sp2.sourceManualHint": "vous le définissez depuis les incidents",
    "sp2.monitorLabel": "Moniteur",
    "sp2.noMonitors": "Aucun moniteur — créez-en un dans Moniteurs, ou gardez le composant manuel.",
    "sp2.addComponent": "Ajouter le composant",
    "sp2.trackedNote":
      "Un composant qui suit un moniteur en reprend l'état, l'uptime et les barres — ni une personne ni un incident publié ne les écrasent.",
    "sp2.noData": "aucune mesure",
    "sp2.uptime90Title": "uptime sur 90 jours",
    "sp2.stateLabel": "État du composant",
    "sp2.settings": "Réglages de la page",
  },
  de: {
    "sp2.countPublic": { one: "{count} öffentlich", other: "{count} öffentliche" },
    "sp2.countInternal": { one: "{count} intern", other: "{count} interne" },
    "sp2.visibilityPublic": "öffentlich",
    "sp2.visibilityInternal": "intern",
    "sp2.componentsNote": "einen Monitor verfolgen = automatischer Status",
    "sp2.auto": "AUTO",
    "sp2.autoTitle": "Status, Verfügbarkeit und Balken werden vom Monitor gelesen.",
    "sp2.manualSource": "manuell · aus Vorfällen gesetzt",
    "sp2.publicFeed": "Öffentliche Vorfälle und Wartungen",
    "sp2.subscribersEyebrow": "Abonnenten · {count}",
    "sp2.chEmail": "E-Mail",
    "sp2.chFeed": "RSS / Atom",
    "sp2.chWebhook": "Webhook",
    "sp2.chSlack": "Slack-Kanäle",
    "sp2.chTeams": "Teams-Kanäle",
    "sp2.unavailable": "nicht verfügbar",
    "sp2.subscribersNote":
      "E-Mail läuft über Double-Opt-in, Abmeldung mit einem Klick. RSS zählt Abrufe des Feeds, keine Personen. Chat-Kanäle sind auf dieser Instanz kein Abonnementkanal.",
    "sp2.internalPage": "Interne Seite",
    "sp2.publicPage": "Öffentliche Seite",
    "sp2.ssoOnly": "nur SSO",
    "sp2.nComponents": { one: "{count} Komponente", other: "{count} Komponenten" },
    "sp2.openPage": "Öffnen →",
    "sp2.addComponentTitle": "Komponente hinzufügen",
    "sp2.editComponentTitle": "Komponente bearbeiten",
    "sp2.editMaintenanceTitle": "Wartung verschieben",
    "sp2.maintenanceMoved": "Wartung aktualisiert. Abonnenten wurden nicht erneut benachrichtigt.",
    "sp2.updateCorrected":
      "Meldung korrigiert. Die Seite weist darauf hin; niemand wurde erneut benachrichtigt.",
    "sp2.editMaintenanceNote":
      "Nur ein Fenster, das noch nicht begonnen hat, lässt sich verschieben. Geänderte Termine ergänzen eine Zeile in der öffentlichen Chronik; ein umformulierter Text nicht — die Seite zeigt ihn bereits.",
    "sp2.publicName": "Öffentlicher Name",
    "sp2.descriptionLabel": "Eine öffentliche Zeile",
    "sp2.descriptionHint": "Woran ein Besucher die Sache erkennt",
    "sp2.sourceLabel": "Der Status kommt von",
    "sp2.sourceMonitor": "Einem Monitor",
    "sp2.sourceMonitorHint": "automatischer Status, Verfügbarkeit über 90 Tage, 90 Tage Balken",
    "sp2.sourceManual": "Manuell",
    "sp2.sourceManualHint": "Sie setzen ihn aus den Vorfällen",
    "sp2.monitorLabel": "Monitor",
    "sp2.noMonitors":
      "Noch kein Monitor — legen Sie einen unter Monitore an, oder lassen Sie die Komponente manuell.",
    "sp2.addComponent": "Hinzufügen",
    "sp2.trackedNote":
      "Eine Komponente, die einen Monitor verfolgt, übernimmt dessen Status, Verfügbarkeit und Balken — weder ein Mensch noch ein veröffentlichter Vorfall überschreibt sie.",
    "sp2.noData": "noch keine Messung",
    "sp2.uptime90Title": "Verfügbarkeit über 90 Tage",
    "sp2.stateLabel": "Status der Komponente",
    "sp2.settings": "Seiteneinstellungen",
  },
} satisfies { en: Part; fr: Part; de: Part };
