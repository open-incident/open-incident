/**
 * What the product is allowed to do — independent of any notion of an offer.
 *
 * A self-hosted install gets the full core set. A deployment driven by a
 * control plane receives its entitlements resolved onto the tenant row, and
 * falls back here when they are missing: a control plane outage must never
 * close the product down.
 */
export type Entitlements = {
  /** Member ceiling (owners, admins and responders — viewers are free) — null: none. */
  maxMembers: number | null;
  /** Public status pages ceiling — null: none. */
  maxStatusPages: number | null;
  /** Assisted summaries, related incidents, drafts. */
  aiAssist: boolean;
  /** Agentic investigations and autonomous playbooks. */
  aiInvestigations: boolean;
  /** SAML/SCIM single sign-on for members. */
  sso: boolean;
  /** Custom roles beyond owner / admin / responder / viewer. */
  customRoles: boolean;
  /** Advanced audit log (export, retention, SIEM forwarding). */
  auditLogAdvanced: boolean;
  /** Per-customer status pages and sub-pages. */
  customerStatusPages: boolean;
  /** Custom domains on status pages. */
  customDomains: boolean;
};

/**
 * The AGPL core, without limits: everything this repository implements outside
 * the ee/ directory, which carries a separate license (see ee/LICENSE).
 */
export const CORE_ENTITLEMENTS: Entitlements = {
  maxMembers: null,
  maxStatusPages: null,
  aiAssist: false,
  aiInvestigations: false,
  sso: false,
  customRoles: false,
  auditLogAdvanced: false,
  customerStatusPages: false,
  customDomains: true,
};
