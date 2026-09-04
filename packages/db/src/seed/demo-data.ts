/**
 * Constants of the FROZEN demonstration data set — Skylark Systems. Shared with
 * packages/auth (identities) and packages/smoke (accounts to sign in with).
 */
export const DEMO_SLUG = "skylark";
export const DEMO_PASSWORD = "demo-openincident";

export const DEMO_MEMBERS = [
  { name: "Amélie Laurent", email: "amelie@skylark.dev", role: "owner" },
  { name: "Karim Haddad", email: "karim@skylark.dev", role: "responder" },
  { name: "Nadia Benali", email: "nadia@skylark.dev", role: "responder" },
  { name: "Lucas Girard", email: "lucas@skylark.dev", role: "responder" },
  { name: "Thomas Moreau", email: "thomas@skylark.dev", role: "responder" },
  { name: "Claire Dubois", email: "claire@skylark.dev", role: "viewer" },
] as const;

/** Invited, never signed in: the pending invitation the Members screen shows. */
export const DEMO_INVITED = {
  name: "Marc Lefèvre",
  email: "marc@skylark.dev",
  role: "responder",
} as const;
