/**
 * settings-v2 — the template's own words: the save bar, the dialogs, the
 * copy buttons, the honest unavailable state.
 */
import type { Message } from "../../../dictionary";

const en = {
  "settingsV2.home": "Settings",
  "settingsV2.on": "On",
  "settingsV2.off": "Off",
  "settingsV2.copy": "Copy",
  "settingsV2.copied": "Copied",
  "settingsV2.saved": "Saved.",
  "settingsV2.unsaved": "Unsaved changes on this page",
  "settingsV2.discard": "Discard",
  "settingsV2.discarded": "Changes discarded.",
  "settingsV2.saveChanges": "Save changes",
  "settingsV2.saving": "Saving…",
  "settingsV2.save": "Save",
  "settingsV2.cancel": "Cancel",
  "settingsV2.close": "Close",
  "settingsV2.done": "Done",
  "settingsV2.edit": "Edit",
  "settingsV2.remove": "Remove",
  "settingsV2.unavailable": "Unavailable on this instance",
  "settingsV2.eeText":
    "This capability belongs to the enterprise edition (the ee/ directory, commercially licensed). The operator switches it on with OI_ENTITLEMENTS; nothing is simulated meanwhile.",
  "settingsV2.ownersOnly": "Owners only",
  "settingsV2.readOnly": "You can read this screen; changing it needs another role.",
  "settingsV2.error.invalid": "Check the values — nothing was saved.",
  "settingsV2.error.generic": "Something went wrong — nothing was saved.",
  "settingsV2.error.name": "Give it a name.",
};

type Part = Record<keyof typeof en, Message>;

export const commonPart = {
  en,
  fr: {
    "settingsV2.home": "Paramètres",
    "settingsV2.on": "Activé",
    "settingsV2.off": "Désactivé",
    "settingsV2.copy": "Copier",
    "settingsV2.copied": "Copié",
    "settingsV2.saved": "Enregistré.",
    "settingsV2.unsaved": "Modifications non enregistrées sur cette page",
    "settingsV2.discard": "Abandonner",
    "settingsV2.discarded": "Modifications abandonnées.",
    "settingsV2.saveChanges": "Enregistrer les modifications",
    "settingsV2.saving": "Enregistrement…",
    "settingsV2.save": "Enregistrer",
    "settingsV2.cancel": "Annuler",
    "settingsV2.close": "Fermer",
    "settingsV2.done": "Terminé",
    "settingsV2.edit": "Modifier",
    "settingsV2.remove": "Retirer",
    "settingsV2.unavailable": "Indisponible sur cette instance",
    "settingsV2.eeText":
      "Cette fonction relève de l’édition entreprise (le répertoire ee/, sous licence commerciale). L’opérateur l’active avec OI_ENTITLEMENTS ; rien n’est simulé en attendant.",
    "settingsV2.ownersOnly": "Réservé aux propriétaires",
    "settingsV2.readOnly": "Vous pouvez lire cet écran ; le modifier demande un autre rôle.",
    "settingsV2.error.invalid": "Vérifiez les valeurs — rien n’a été enregistré.",
    "settingsV2.error.generic": "Une erreur est survenue — rien n’a été enregistré.",
    "settingsV2.error.name": "Donnez-lui un nom.",
  },
  de: {
    "settingsV2.home": "Einstellungen",
    "settingsV2.on": "An",
    "settingsV2.off": "Aus",
    "settingsV2.copy": "Kopieren",
    "settingsV2.copied": "Kopiert",
    "settingsV2.saved": "Gespeichert.",
    "settingsV2.unsaved": "Ungespeicherte Änderungen auf dieser Seite",
    "settingsV2.discard": "Verwerfen",
    "settingsV2.discarded": "Änderungen verworfen.",
    "settingsV2.saveChanges": "Änderungen speichern",
    "settingsV2.saving": "Wird gespeichert…",
    "settingsV2.save": "Speichern",
    "settingsV2.cancel": "Abbrechen",
    "settingsV2.close": "Schließen",
    "settingsV2.done": "Fertig",
    "settingsV2.edit": "Bearbeiten",
    "settingsV2.remove": "Entfernen",
    "settingsV2.unavailable": "Auf dieser Instanz nicht verfügbar",
    "settingsV2.eeText":
      "Diese Funktion gehört zur Enterprise Edition (das Verzeichnis ee/, kommerziell lizenziert). Der Betreiber schaltet sie mit OI_ENTITLEMENTS frei; bis dahin wird nichts simuliert.",
    "settingsV2.ownersOnly": "Nur für Eigentümer",
    "settingsV2.readOnly": "Sie können diese Seite lesen; zum Ändern braucht es eine andere Rolle.",
    "settingsV2.error.invalid": "Prüfen Sie die Werte — nichts wurde gespeichert.",
    "settingsV2.error.generic": "Etwas ist schiefgelaufen — nichts wurde gespeichert.",
    "settingsV2.error.name": "Geben Sie einen Namen ein.",
  },
} satisfies { en: Part; fr: Part; de: Part };
