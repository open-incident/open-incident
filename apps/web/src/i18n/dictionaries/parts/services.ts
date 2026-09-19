/**
 * Labels of the Services area, in the three languages.
 *
 * Runbooks live here because they belong to a service: they used to be edited
 * from a screen the product no longer has, and their home is now the service's
 * own page.
 *
 * Note the absence of `as const`: the part is spread into `en.ts`, and a
 * literal type there would force the French and German values to be the
 * English string.
 */
import type { Message } from "../../dictionary";

const en = {
  "svc.runbooks.title": "Runbooks",
  "svc.runbooks.none": "No runbook for this service.",
  "svc.runbooks.name": "Title",
  "svc.runbooks.url": "File URL — GitHub or GitLab file, or any text/markdown address",
  "svc.runbooks.content": "…or paste the runbook text here",
  "svc.runbooks.add": "Add",
  "svc.runbooks.refresh": "Fetch again",
  "svc.runbooks.error": "A title and either a URL or some text are required.",
  "svc.runbooks.fetchError": "fetch failed: {error} — the last copy is kept",
  "svc.runbooks.fetchedAt": "fetched {when}",
  "svc.runbooks.pasted": "pasted text · {chars} characters",
  "svc.runbooks.hint":
    "Fetched now and refreshed every six hours. Read by the assistant when documentation is an allowed source.",
};

type Part = Record<keyof typeof en, Message>;

const fr = {
  "svc.runbooks.title": "Runbooks",
  "svc.runbooks.none": "Aucun runbook pour ce service.",
  "svc.runbooks.name": "Titre",
  "svc.runbooks.url": "URL du fichier — fichier GitHub ou GitLab, ou toute adresse texte/markdown",
  "svc.runbooks.content": "…ou collez le texte du runbook ici",
  "svc.runbooks.add": "Ajouter",
  "svc.runbooks.refresh": "Récupérer à nouveau",
  "svc.runbooks.error": "Un titre et soit une URL, soit du texte sont nécessaires.",
  "svc.runbooks.fetchError": "récupération échouée : {error} — la dernière copie est conservée",
  "svc.runbooks.fetchedAt": "récupéré {when}",
  "svc.runbooks.pasted": "texte collé · {chars} caractères",
  "svc.runbooks.hint":
    "Récupéré maintenant, puis toutes les six heures. Lu par l'assistant quand la documentation est une source autorisée.",
};

const de = {
  "svc.runbooks.title": "Runbooks",
  "svc.runbooks.none": "Kein Runbook für diesen Dienst.",
  "svc.runbooks.name": "Titel",
  "svc.runbooks.url": "Datei-URL — GitHub- oder GitLab-Datei oder eine Text-/Markdown-Adresse",
  "svc.runbooks.content": "…oder fügen Sie den Runbook-Text hier ein",
  "svc.runbooks.add": "Hinzufügen",
  "svc.runbooks.refresh": "Erneut abrufen",
  "svc.runbooks.error": "Ein Titel und entweder eine URL oder Text sind erforderlich.",
  "svc.runbooks.fetchError": "Abruf fehlgeschlagen: {error} — die letzte Kopie bleibt erhalten",
  "svc.runbooks.fetchedAt": "abgerufen {when}",
  "svc.runbooks.pasted": "eingefügter Text · {chars} Zeichen",
  "svc.runbooks.hint":
    "Jetzt abgerufen und alle sechs Stunden aktualisiert. Wird vom Assistenten gelesen, wenn Dokumentation eine erlaubte Quelle ist.",
};

export const servicesPart = { en, fr, de } satisfies { en: Part; fr: Part; de: Part };
