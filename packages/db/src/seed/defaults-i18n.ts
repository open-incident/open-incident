/**
 * The example content every new workspace starts with, in its own language.
 * Three languages for now — the product's dictionaries (apps/web/src/i18n)
 * grow to the 25 the platform targets; the seed follows them.
 */
type Lang = "en" | "fr" | "de";

const TEXT: Record<string, Record<Lang, string>> = {
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
  "catalog.team": { en: "Teams", fr: "Équipes", de: "Teams" },
  "catalog.team.desc": {
    en: "Who owns what — every escalation resolves through a team.",
    fr: "Qui possède quoi — toute escalade se résout via une équipe.",
    de: "Wer was besitzt – jede Eskalation läuft über ein Team.",
  },
  "catalog.service": { en: "Services", fr: "Services", de: "Dienste" },
  "catalog.service.desc": {
    en: "What can break — the entry an alert names.",
    fr: "Ce qui peut casser — l'entrée qu'une alerte nomme.",
    de: "Was ausfallen kann – der Eintrag, den ein Alarm nennt.",
  },
  "catalog.environment": { en: "Environments", fr: "Environnements", de: "Umgebungen" },
  "catalog.environment.desc": {
    en: "Where it runs — production pages, staging stays quiet.",
    fr: "Où ça tourne — production bipe, staging reste silencieux.",
    de: "Wo es läuft – Produktion alarmiert, Staging bleibt still.",
  },
  "attr.owner": { en: "Owner team", fr: "Équipe propriétaire", de: "Verantwortliches Team" },
  "attr.repository": { en: "Repository", fr: "Dépôt", de: "Repository" },
  "attr.tier": { en: "Tier", fr: "Niveau", de: "Stufe" },
  "attr.environments": { en: "Environments", fr: "Environnements", de: "Umgebungen" },
  "attr.members": { en: "Members", fr: "Membres", de: "Mitglieder" },
  "attr.escalationPath": { en: "Escalation path", fr: "Chemin d'escalade", de: "Eskalationspfad" },
  "attr.chatChannel": { en: "Chat channel", fr: "Canal de chat", de: "Chat-Kanal" },
  "attr.paging": { en: "Paging", fr: "Bipe", de: "Alarmierung" },
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
