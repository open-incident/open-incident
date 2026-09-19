/**
 * The example content every new workspace starts with, in its own language.
 * Three languages for now — the product's dictionaries (apps/web/src/i18n)
 * grow to the 25 the platform targets; the seed follows them.
 */
type Lang = "en" | "fr" | "de";

const TEXT: Record<string, Record<Lang, string>> = {
  "aprio.p1.desc": {
    en: "Page now — the on-call responder is woken up.",
    fr: "Réveiller maintenant — la personne d'astreinte est appelée.",
    de: "Jetzt alarmieren – die Person im Bereitschaftsdienst wird geweckt.",
  },
  "aprio.p2.desc": {
    en: "Page — during the day, by the responder's own channels.",
    fr: "Appeler — en journée, par les canaux choisis par la personne.",
    de: "Alarmieren – tagsüber, über die eigenen Kanäle der Person.",
  },
  "aprio.p3.desc": {
    en: "Notify quietly — no page; looked at during working hours.",
    fr: "Prévenir sans réveiller — traité aux heures de travail.",
    de: "Leise benachrichtigen – kein Alarm; wird in der Arbeitszeit angesehen.",
  },
  "aattr.service": { en: "Service", fr: "Service", de: "Dienst" },
  "aattr.service.desc": {
    en: "The service the alert is about — matched against the ones already seen.",
    fr: "Le service concerné — rapproché de ceux déjà observés.",
    de: "Der betroffene Dienst – abgeglichen mit den bereits beobachteten.",
  },
  "aattr.team": { en: "Team", fr: "Équipe", de: "Team" },
  "aattr.team.desc": {
    en: "The team that owns it — read from the payload, or derived from the service's owner.",
    fr: "L'équipe responsable — lue dans le payload, ou déduite du propriétaire du service.",
    de: "Das verantwortliche Team – aus dem Payload gelesen oder vom Besitzer des Dienstes abgeleitet.",
  },
  "aattr.environment": { en: "Environment", fr: "Environnement", de: "Umgebung" },
  "aattr.environment.desc": {
    en: "production, staging… what most routes filter on first.",
    fr: "production, staging… ce que la plupart des routes filtrent en premier.",
    de: "production, staging… wonach die meisten Routen zuerst filtern.",
  },
  "aattr.region": { en: "Region", fr: "Région", de: "Region" },
  "aattr.region.desc": {
    en: "Where it happens: a cloud region, a datacenter, a zone.",
    fr: "Où cela se passe : une région cloud, un datacenter, une zone.",
    de: "Wo es passiert: eine Cloud-Region, ein Rechenzentrum, eine Zone.",
  },
  "aattr.severity": { en: "Tool severity", fr: "Sévérité de l'outil", de: "Schwere des Tools" },
  "aattr.severity.desc": {
    en: "The monitoring tool's own level, kept as it was sent; the priority is the product's reading of it.",
    fr: "Le niveau de l'outil de supervision, tel qu'envoyé ; la priorité est la lecture qu'en fait le produit.",
    de: "Die Stufe des Monitoring-Tools, wie gesendet; die Priorität ist die Lesart des Produkts.",
  },
  "route.default": { en: "Every alert", fr: "Toutes les alertes", de: "Jeder Alarm" },
  "route.default.desc": {
    en: "Catches every alert from every source and opens a triage incident when the priority pages. Name who to page and you are live.",
    fr: "Attrape chaque alerte de chaque source et ouvre un incident en triage quand la priorité appelle. Nommez qui appeler et c'est en service.",
    de: "Fängt jeden Alarm jeder Quelle und öffnet einen Triage-Vorfall, wenn die Priorität alarmiert. Benennen Sie, wer alarmiert wird, und es läuft.",
  },
  "type.default": { en: "Default", fr: "Défaut", de: "Standard" },
  "type.default.desc": {
    en: "The generic type — every operational incident goes through it.",
    fr: "Type générique — tout incident opérationnel passe par lui.",
    de: "Der generische Typ – jeder Betriebsvorfall läuft über ihn.",
  },
  "status.investigating": { en: "Investigating", fr: "Investigation", de: "Untersuchung" },
  "status.investigating.desc": {
    en: "Looking for the cause — impact is confirmed and a lead is assigned.",
    fr: "On cherche la cause — l'impact est confirmé et le lead est assigné.",
    de: "Ursachensuche – die Auswirkung ist bestätigt, eine Leitung ist zugewiesen.",
  },
  "status.fixing": { en: "Fixing", fr: "Correction", de: "Behebung" },
  "status.fixing.desc": {
    en: "The cause is known — a fix is being rolled out.",
    fr: "La cause est identifiée — un correctif est en cours de déploiement.",
    de: "Die Ursache ist bekannt – eine Korrektur wird ausgerollt.",
  },
  "status.monitoring": { en: "Monitoring", fr: "Surveillance", de: "Beobachtung" },
  "status.monitoring.desc": {
    en: "The fix is out — watching before resolving.",
    fr: "Le correctif est déployé — on observe avant de résoudre.",
    de: "Die Korrektur ist live – Beobachtung vor der Lösung.",
  },
  "sev1.desc": {
    en: "Critical — the product is down or unusable for everyone.",
    fr: "Critique — le produit est indisponible ou inutilisable pour tous.",
    de: "Kritisch – das Produkt ist für alle nicht verfügbar oder unbenutzbar.",
  },
  "sev2.desc": {
    en: "Major — a core flow is degraded for many users.",
    fr: "Majeur — un flux cœur dégradé pour beaucoup d'utilisateurs.",
    de: "Schwer – ein Kernablauf ist für viele Nutzer beeinträchtigt.",
  },
  "sev3.desc": {
    en: "Partial — degraded for some, a workaround exists.",
    fr: "Partiel — dégradé pour certains, contournement possible.",
    de: "Teilweise – für einige beeinträchtigt, Umgehung möglich.",
  },
  "sev4.desc": {
    en: "Minor — cosmetic or low impact.",
    fr: "Mineur — cosmétique ou impact faible.",
    de: "Gering – kosmetisch oder geringe Auswirkung.",
  },
  "role.lead": { en: "Incident lead", fr: "Pilote de l'incident", de: "Vorfallleitung" },
  "role.lead.desc": {
    en: "Owns the response: decides, delegates, keeps the timeline honest.",
    fr: "Pilote la réponse : décide, délègue, tient la timeline à jour.",
    de: "Führt die Reaktion: entscheidet, delegiert, hält die Zeitleiste aktuell.",
  },
  "role.lead.instructions": {
    en: "Confirm the severity, name the affected service, share an update within 15 minutes, then every 30.",
    fr: "Confirmez la sévérité, nommez le service affecté, partagez une mise à jour sous 15 minutes, puis toutes les 30.",
    de: "Schweregrad bestätigen, betroffenen Dienst benennen, innerhalb von 15 Minuten ein Update teilen, dann alle 30.",
  },
  "role.comms": { en: "Communication", fr: "Communication", de: "Kommunikation" },
  "role.comms.desc": {
    en: "Speaks for the incident: internal announcements and the status page.",
    fr: "Porte la parole de l'incident : annonces internes et page de statut.",
    de: "Spricht für den Vorfall: interne Ankündigungen und die Statusseite.",
  },
  "prio.p1.desc": {
    en: "Must be closed within 14 days.",
    fr: "À clore sous 14 jours.",
    de: "Innerhalb von 14 Tagen zu schließen.",
  },
  "prio.p2.desc": {
    en: "Must be closed within 30 days.",
    fr: "À clore sous 30 jours.",
    de: "Innerhalb von 30 Tagen zu schließen.",
  },
  "prio.p3.desc": { en: "No deadline.", fr: "Sans échéance.", de: "Ohne Frist." },
  "task.reviewTimeline": {
    en: "Review and organise the timeline",
    fr: "Relire et organiser la timeline",
    de: "Zeitleiste prüfen und ordnen",
  },
  "task.createPostMortem": {
    en: "Create the post-mortem",
    fr: "Créer le post-mortem",
    de: "Post-Mortem erstellen",
  },
  "task.scheduleDebrief": {
    en: "Schedule the debrief",
    fr: "Programmer le débrief",
    de: "Nachbesprechung planen",
  },
  "task.reviewFollowUps": {
    en: "Review the follow-ups",
    fr: "Relire les suivis",
    de: "Folgemaßnahmen prüfen",
  },
  "task.sharePostMortem": {
    en: "Share the post-mortem",
    fr: "Diffuser le post-mortem",
    de: "Post-Mortem verteilen",
  },
  "task.holdDebrief": {
    en: "Hold the debrief",
    fr: "Tenir le débrief",
    de: "Nachbesprechung abhalten",
  },
};

export function seedText(key: string, locale: string): string {
  const entry = TEXT[key];
  if (!entry) throw new Error(`seed text missing: ${key}`);
  return entry[(locale as Lang) in entry ? (locale as Lang) : "en"];
}
