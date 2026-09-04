/**
 * Deployment mode: a standalone install, or one driven by an external control
 * plane that supplies its entitlements and lifecycle.
 *
 * `OPENINCIDENT_EDITION` is read SERVER-SIDE only. Never `NEXT_PUBLIC_`: the
 * same image serves both modes, and `process.env` is empty in the browser — a
 * client component calling these functions would silently see the default
 * there. Client components receive the mode as props.
 */
export const EDITIONS = ["self-hosted", "cloud"] as const;
export type Edition = (typeof EDITIONS)[number];

/** Current mode — standalone by default: a clone that boots is self-hosted. */
export function getEdition(): Edition {
  return process.env.OPENINCIDENT_EDITION === "cloud" ? "cloud" : "self-hosted";
}

export function isCloud(): boolean {
  return getEdition() === "cloud";
}

export function isSelfHosted(): boolean {
  return getEdition() === "self-hosted";
}
