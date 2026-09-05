---
title: Enterprise edition
section: enterprise
order: 21
summary: What the ee/ directory adds, how a capability is switched on, and what the licence says.
---

## What it is

Everything outside the `ee/` directory is AGPL-3.0. The `ee/` directory carries the enterprise capabilities under a **commercial licence** (`ee/LICENSE`): free to use in development and testing; production requires a commercial agreement. The product serves them through thin shells, so the URLs are the same — only the licence boundary moves.

Today the enterprise edition carries:

| Capability                                                                                        | Entitlement   | Chapter                      |
| ------------------------------------------------------------------------------------------------- | ------------- | ---------------------------- |
| **Single sign-on** — OpenID Connect and SAML 2.0 connections, just-in-time membership, "SSO only" | `sso`         | [Single sign-on](sso)        |
| **SCIM 2.0 provisioning** — members and teams kept in step with the identity provider             | `sso`         | [Provisioning (SCIM)](scim)  |
| **Custom roles** — permission sets beyond the four built-in roles                                 | `customRoles` | [Custom roles](custom-roles) |

Planned in the same directory: the advanced audit log (export, retention, SIEM forwarding), customer status pages and sub-pages.

## Switching a capability on

On a **standalone instance** the operator lists the entitlements in the environment:

```bash
OI_ENTITLEMENTS=sso,customRoles
```

and restarts the web and worker services. In a **control-plane deployment** (`OPENINCIDENT_EDITION=cloud`) the entitlements are resolved onto the workspace by the control plane; the product reads them and never computes them.

In that deployment the workspace also gets **Settings → Subscription & invoices**: the plan and its trial, the seats it covers, this month's usage against the plan's ceilings, the offers as the control plane sells them, the invoices it mirrors from the payment provider, and the checkout and customer-portal actions — each one a redirect to a session the control plane opens. The product carries no price and no card. Owners act, other managers read, and a paused workspace keeps this one screen reachable so the owner can subscribe again. A self-hosted instance does not have the screen.

Without the entitlement, the screens in **Settings → Enterprise** say _Unavailable on this instance_ and name the variable; the SCIM endpoint answers 403; custom roles already assigned fall back to their base role. Nothing is simulated.

## The seam, for the curious

`apps/web` renders an enterprise screen with one line — a page that renders `@openincident/ee-web`'s component, an action that calls its function, a route that re-exports its handlers. The permission vocabulary the custom roles use lives in the core (`@openincident/config`), because every check in the product goes through it; the role editor lives in `ee/`.
