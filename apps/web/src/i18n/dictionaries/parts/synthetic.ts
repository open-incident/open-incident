/**
 * Labels of the synthetic monitor — the journey editor and what a run left
 * behind — in the three languages.
 *
 * Each language holds exactly the same keys: English is the source the
 * `Dictionary` type derives from, so a gap elsewhere does not compile.
 *
 * Note the absence of `as const`: the part is spread into `en.ts`, and a
 * literal type there would force the French and German values to be the English
 * string.
 */
import type { Message } from "../../dictionary";

const en = {
  "synthetic.journey": "JOURNEY",
  "synthetic.journeyHint":
    "A list of steps, played top to bottom in a real browser. Each one is timed on its own.",
  "synthetic.steps": { one: "{count} step", other: "{count} steps" },
  "synthetic.noSteps": "No step yet — a journey needs at least one.",
  "synthetic.addStep": "Add a step",
  "synthetic.remove": "Remove",
  "synthetic.up": "Move up",
  "synthetic.down": "Move down",
  "synthetic.colStep": "STEP",
  "synthetic.colSelector": "SELECTOR",
  "synthetic.colValue": "VALUE",
  "synthetic.colTimeout": "S",
  "synthetic.selectorPlaceholder": "#email · button[type=submit] · text=Sign in",
  "synthetic.valuePlaceholder": "https://… · the text to type · what to expect",
  "synthetic.kind.goto": "go to",
  "synthetic.kind.click": "click",
  "synthetic.kind.fill": "fill",
  "synthetic.kind.select": "select",
  "synthetic.kind.waitFor": "wait for",
  "synthetic.kind.expectText": "expect text",
  "synthetic.kind.expectUrl": "expect url",
  "synthetic.kind.expectStatus": "expect status",
  "synthetic.budget": "Budget for the whole journey",
  "synthetic.budgetSeconds": { one: "{count} second", other: "{count} seconds" },
  "synthetic.floorNote":
    "A browser run is expensive: five minutes is the shortest interval this type accepts.",
  "synthetic.credentials": "CREDENTIALS",
  "synthetic.credentialsHint":
    "Stored encrypted and never shown again. Name it here, then use it in a step as {{secrets.NAME}}.",
  "synthetic.secretName": "NAME",
  "synthetic.secretValue": "VALUE",
  "synthetic.addSecret": "Add a credential",
  "synthetic.secretNameRule": "Letters, digits and underscores.",
  "synthetic.secretsNone": "No credential.",
  "synthetic.secretStored": "stored",
  "synthetic.secretSave": "Save",
  "synthetic.secretMissing": {
    one: "This journey names {names}, which this monitor does not carry.",
    other: "This journey names {names}, which this monitor does not carry.",
  },
  "synthetic.lastRun": "LAST RUN",
  "synthetic.noRun": "No run yet — the first one starts within the interval.",
  "synthetic.notRun": "not run",
  "synthetic.runQueued": "Run queued — the browser runner takes it within seconds.",
  "synthetic.failedAt": "Failed at step {step}",
  "synthetic.screenshot": "Screenshot of the failure",
  "synthetic.screenshotOpen": "Open it full size",
  "synthetic.screenshotMasked": "Credential fields are painted over before the image is taken.",
  "synthetic.editJourney": "Edit the journey",
  "synthetic.saveJourney": "Save the journey",
  "synthetic.errorSteps": "That journey could not be read — check the steps.",
  "synthetic.errorSecret": "A credential needs a name (letters, digits, underscores) and a value.",
  "synthetic.errorNoRunner":
    "Nothing ran: no browser runner announced itself on this instance. Start it with docker compose --profile synthetic up -d synthetic",
  "synthetic.runnerOffline":
    "The browser runner is not running on this instance, so this monitor is not being played. Start it with docker compose --profile synthetic up -d synthetic",
};

type Part = Record<keyof typeof en, Message>;

export const syntheticPart = {
  en,
  fr: {
    "synthetic.journey": "PARCOURS",
    "synthetic.journeyHint":
      "Une liste d'étapes, jouée de haut en bas dans un vrai navigateur. Chacune est chronométrée à part.",
    "synthetic.steps": { one: "{count} étape", other: "{count} étapes" },
    "synthetic.noSteps": "Aucune étape — un parcours en demande au moins une.",
    "synthetic.addStep": "Ajouter une étape",
    "synthetic.remove": "Retirer",
    "synthetic.up": "Monter",
    "synthetic.down": "Descendre",
    "synthetic.colStep": "ÉTAPE",
    "synthetic.colSelector": "SÉLECTEUR",
    "synthetic.colValue": "VALEUR",
    "synthetic.colTimeout": "S",
    "synthetic.selectorPlaceholder": "#email · button[type=submit] · text=Se connecter",
    "synthetic.valuePlaceholder": "https://… · le texte à saisir · ce qu'on attend",
    "synthetic.kind.goto": "aller à",
    "synthetic.kind.click": "cliquer",
    "synthetic.kind.fill": "saisir",
    "synthetic.kind.select": "choisir",
    "synthetic.kind.waitFor": "attendre",
    "synthetic.kind.expectText": "attendre le texte",
    "synthetic.kind.expectUrl": "attendre l'adresse",
    "synthetic.kind.expectStatus": "attendre le code",
    "synthetic.budget": "Budget pour tout le parcours",
    "synthetic.budgetSeconds": { one: "{count} seconde", other: "{count} secondes" },
    "synthetic.floorNote":
      "Une exécution de navigateur coûte cher : cinq minutes est le plus court intervalle accepté par ce type.",
    "synthetic.credentials": "IDENTIFIANTS",
    "synthetic.credentialsHint":
      "Chiffrés au repos et jamais réaffichés. Nommez-les ici, puis utilisez-les dans une étape avec {{secrets.NOM}}.",
    "synthetic.secretName": "NOM",
    "synthetic.secretValue": "VALEUR",
    "synthetic.addSecret": "Ajouter un identifiant",
    "synthetic.secretNameRule": "Lettres, chiffres et tirets bas.",
    "synthetic.secretsNone": "Aucun identifiant.",
    "synthetic.secretStored": "enregistré",
    "synthetic.secretSave": "Enregistrer",
    "synthetic.secretMissing": {
      one: "Ce parcours nomme {names}, que ce moniteur ne porte pas.",
      other: "Ce parcours nomme {names}, que ce moniteur ne porte pas.",
    },
    "synthetic.lastRun": "DERNIÈRE EXÉCUTION",
    "synthetic.noRun": "Aucune exécution — la première part dans l'intervalle.",
    "synthetic.notRun": "non jouée",
    "synthetic.runQueued":
      "Exécution en file — l'exécuteur navigateur la prend en quelques secondes.",
    "synthetic.failedAt": "Échec à l'étape {step}",
    "synthetic.screenshot": "Capture de l'échec",
    "synthetic.screenshotOpen": "L'ouvrir en grand",
    "synthetic.screenshotMasked":
      "Les champs d'identifiants sont masqués avant la prise de l'image.",
    "synthetic.editJourney": "Modifier le parcours",
    "synthetic.saveJourney": "Enregistrer le parcours",
    "synthetic.errorSteps": "Ce parcours n'a pas pu être lu — vérifiez les étapes.",
    "synthetic.errorSecret":
      "Un identifiant demande un nom (lettres, chiffres, tirets bas) et une valeur.",
    "synthetic.errorNoRunner":
      "Rien n'a été joué : aucun exécuteur navigateur ne s'est annoncé sur cette instance. Démarrez-le avec docker compose --profile synthetic up -d synthetic",
    "synthetic.runnerOffline":
      "L'exécuteur navigateur ne tourne pas sur cette instance, ce moniteur n'est donc pas joué. Démarrez-le avec docker compose --profile synthetic up -d synthetic",
  },
  de: {
    "synthetic.journey": "ABLAUF",
    "synthetic.journeyHint":
      "Eine Liste von Schritten, von oben nach unten in einem echten Browser gespielt. Jeder wird einzeln gemessen.",
    "synthetic.steps": { one: "{count} Schritt", other: "{count} Schritte" },
    "synthetic.noSteps": "Noch kein Schritt — ein Ablauf braucht mindestens einen.",
    "synthetic.addStep": "Schritt hinzufügen",
    "synthetic.remove": "Entfernen",
    "synthetic.up": "Nach oben",
    "synthetic.down": "Nach unten",
    "synthetic.colStep": "SCHRITT",
    "synthetic.colSelector": "SELEKTOR",
    "synthetic.colValue": "WERT",
    "synthetic.colTimeout": "S",
    "synthetic.selectorPlaceholder": "#email · button[type=submit] · text=Anmelden",
    "synthetic.valuePlaceholder": "https://… · der einzugebende Text · das Erwartete",
    "synthetic.kind.goto": "öffnen",
    "synthetic.kind.click": "klicken",
    "synthetic.kind.fill": "ausfüllen",
    "synthetic.kind.select": "auswählen",
    "synthetic.kind.waitFor": "warten auf",
    "synthetic.kind.expectText": "Text erwarten",
    "synthetic.kind.expectUrl": "Adresse erwarten",
    "synthetic.kind.expectStatus": "Status erwarten",
    "synthetic.budget": "Budget für den ganzen Ablauf",
    "synthetic.budgetSeconds": { one: "{count} Sekunde", other: "{count} Sekunden" },
    "synthetic.floorNote":
      "Ein Browserlauf ist teuer: fünf Minuten ist das kürzeste Intervall, das dieser Typ annimmt.",
    "synthetic.credentials": "ZUGANGSDATEN",
    "synthetic.credentialsHint":
      "Verschlüsselt gespeichert und nie wieder angezeigt. Hier benennen, dann in einem Schritt als {{secrets.NAME}} verwenden.",
    "synthetic.secretName": "NAME",
    "synthetic.secretValue": "WERT",
    "synthetic.addSecret": "Zugangsdatum hinzufügen",
    "synthetic.secretNameRule": "Buchstaben, Ziffern und Unterstriche.",
    "synthetic.secretsNone": "Keine Zugangsdaten.",
    "synthetic.secretStored": "gespeichert",
    "synthetic.secretSave": "Speichern",
    "synthetic.secretMissing": {
      one: "Dieser Ablauf nennt {names}, was dieser Monitor nicht trägt.",
      other: "Dieser Ablauf nennt {names}, was dieser Monitor nicht trägt.",
    },
    "synthetic.lastRun": "LETZTER LAUF",
    "synthetic.noRun": "Noch kein Lauf — der erste startet innerhalb des Intervalls.",
    "synthetic.notRun": "nicht gelaufen",
    "synthetic.runQueued": "Lauf eingereiht — der Browser-Runner nimmt ihn in Sekunden.",
    "synthetic.failedAt": "Gescheitert bei Schritt {step}",
    "synthetic.screenshot": "Screenshot des Fehlers",
    "synthetic.screenshotOpen": "In voller Größe öffnen",
    "synthetic.screenshotMasked": "Felder mit Zugangsdaten werden vor der Aufnahme übermalt.",
    "synthetic.editJourney": "Ablauf bearbeiten",
    "synthetic.saveJourney": "Ablauf speichern",
    "synthetic.errorSteps": "Dieser Ablauf war nicht lesbar — prüfen Sie die Schritte.",
    "synthetic.errorSecret":
      "Ein Zugangsdatum braucht einen Namen (Buchstaben, Ziffern, Unterstriche) und einen Wert.",
    "synthetic.errorNoRunner":
      "Nichts gelaufen: kein Browser-Runner hat sich auf dieser Instanz gemeldet. Starten Sie ihn mit docker compose --profile synthetic up -d synthetic",
    "synthetic.runnerOffline":
      "Der Browser-Runner läuft auf dieser Instanz nicht, dieser Monitor wird also nicht gespielt. Starten Sie ihn mit docker compose --profile synthetic up -d synthetic",
  },
} satisfies { en: Part; fr: Part; de: Part };
