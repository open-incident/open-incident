# /ee — commercially licensed features

This directory holds the features under a **commercial licence** (open-core
model, see the "Licensing" section of the README). `web/` is the
`@openincident/ee-web` package, served by `apps/web` through thin shells — a
page that renders the package's screen, an action that calls its function, a
route that re-exports its handlers — so the URLs do not change, the licence
boundary does. Today it carries:

- `auth/` — the Better Auth plugins: single sign-on (OIDC and SAML 2.0) with
  just-in-time membership, and the "SSO only" rule for enforced domains.
- `sso/` — the connections (`app.sso_connections` + `auth.sso_provider`) and
  Settings → Single sign-on.
- `scim/` — the SCIM 2.0 endpoint (`/scim/v2`: Users ↔ members, Groups ↔
  catalog teams) and Settings → Provisioning.
- `roles/` — custom roles as permission sets (`app.custom_roles`) and
  Settings → Custom roles. The permission vocabulary itself lives in the core
  (`@openincident/config`), since every check in the product goes through it.

Each capability is gated by an entitlement (`sso`, `customRoles`): on a
standalone install the operator lists them in `OI_ENTITLEMENTS`; in cloud the
control plane resolves them. Without the entitlement the screen says so —
nothing is simulated. Still to come here: the advanced audit log, customer
status pages and sub-pages.

The rest of the repository is under AGPL-3.0. The packages in this directory
are **not** covered by that licence — see [`ee/LICENSE`](LICENSE): free to use
in development and testing, production requires a commercial agreement.
Package convention: `"license": "SEE LICENSE IN ../LICENSE"`.
