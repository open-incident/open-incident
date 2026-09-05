---
title: API and automation
section: integrations
order: 20
summary: Keys and scopes, the endpoints, pagination and errors, outbound webhooks and how to verify them, change events from CI, the OpenAPI contract.
---

## Where the contract lives

The instance serves its own OpenAPI 3 document at `/api/v1/openapi.json`, built from `@openincident/api-spec` — the single source the developer site renders its reference from. A test walks the route files of `apps/web/src/app/api/v1` and compares them, method by method, with that document: an endpoint added without documentation fails the build, and so does a documented endpoint the product does not answer.

## Keys and scopes

Create keys in **Settings → API & webhooks**. A key is `oi_live_` followed by 32 hex characters, shown once; the instance stores its SHA-256. Send it as `Authorization: Bearer oi_live_…` to `https://<workspace host>/api/v1/…` — the key resolves its own workspace, whatever host the request came in on.

| Scope             | Allows                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`            | Reading incidents, follow-ups, the catalog, change events, status pages.                                                                    |
| `write`           | Everything, including declaring and updating incidents, writing the catalog, recording change events. Implies `read` and `incident:create`. |
| `incident:create` | Declaring incidents only — the narrow scope for an ingestion script.                                                                        |

## The contract

- **Pagination**: `?limit=` (100 at most) and `?cursor=`; a list answers `{ data: […], next_cursor: "…" | null }`.
- **Rate limit**: 600 requests per minute per key → `429 rate_limited`.
- **Errors**: always `{ error: { code, message } }` — `401 unknown_key`, `403 missing_scope`, `403 workspace_suspended`, `404 not_found`, `422 invalid_body` / `unknown_service` / `unknown_type` / `missing_field`, `409` on conflicts.
- **OpenAPI**: `GET /api/v1/openapi.json`, served by the instance with its own URL.

## Endpoints

| Method and path                                           | What it does                                                                                                                                                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /incidents`                                          | List, newest activity first; filters on phase and severity.                                                                                                                                                                                                  |
| `POST /incidents`                                         | Declare: `{ name, severity, service, type?, summary?, mode?, declared_at?, custom_fields? }`. The same write path as the web form: the type's required fields are enforced, a restricted type refused, the incident announced and channelled like any other. |
| `GET /incidents/{ref}`                                    | One incident by number or `INC-n`.                                                                                                                                                                                                                           |
| `POST /incidents/{ref}/updates`                           | Share an update: `{ message, status?, severity?, next_update_in_minutes? }` — `status` is one of the type's statuses, or `"resolved"`.                                                                                                                       |
| `GET /incidents/{ref}/timeline`                           | The events.                                                                                                                                                                                                                                                  |
| `GET` / `POST /incidents/{ref}/follow-ups`                | Follow-ups of an incident.                                                                                                                                                                                                                                   |
| `GET /follow-ups`                                         | Across incidents, filtered by status.                                                                                                                                                                                                                        |
| `GET` / `POST /change-events`                             | Deploys, flags and config changes (see below).                                                                                                                                                                                                               |
| `GET` / `POST /catalog/types`                             | Types and their attribute schemas; create or update by key.                                                                                                                                                                                                  |
| `GET` / `POST /catalog/entries`                           | Entries, filtered by type; upsert one or a list.                                                                                                                                                                                                             |
| `GET` / `DELETE /catalog/entries/{id}`                    | One entry with what references it; deletion refused with `409 entry_in_use` while referenced.                                                                                                                                                                |
| `POST /catalog/import`                                    | A whole bundle in one transaction.                                                                                                                                                                                                                           |
| `GET /status-pages`, `GET /status-pages/{slug}/incidents` | Pages and their public incidents.                                                                                                                                                                                                                            |

```bash
# Declare an incident from a script
curl -X POST https://acme.your-domain.example/api/v1/incidents \
  -H "Authorization: Bearer oi_live_…" -H "Content-Type: application/json" \
  -d '{"name":"Elevated 5xx on checkout-api","severity":"SEV2","service":"checkout-api","custom_fields":{"region":"eu-west-1"}}'
```

## Change events

Deploys, feature flags and configuration changes are the first thing a responder asks about. Post them from CI:

```bash
curl -X POST https://acme.your-domain.example/api/v1/change-events \
  -H "Authorization: Bearer oi_live_…" -H "Content-Type: application/json" \
  -d '{"kind":"deploy","title":"checkout-api v2.41.0","service":"checkout-api","environment":"production","actor":"github-actions","external_ref":"https://github.com/acme/checkout/actions/runs/123"}'
```

The incident's side panel lists the changes recorded on the affected service in the day before the incident and until its resolution, and the assistant reads them when the source is allowed.

## Outbound webhooks

An endpoint subscribes to events in **Settings → API & webhooks**: `incident.created`, `incident.updated`, `incident.update_published`, `incident.resolved`, `follow_up.created`, `alert.created`, `alert.resolved`, `escalation.triggered`, `escalation.acknowledged`, `status_page.incident_published`.

Each delivery is a `POST` with the JSON body `{ event, occurred_at, incident, … }` and three headers: `x-oi-event`, `x-oi-timestamp`, `x-oi-signature: sha256=<HMAC-SHA256(secret, raw body)>`. Verify before trusting:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(rawBody, headers, secret) {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = headers["x-oi-signature"] ?? "";
  if (given.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return false;
  // Refuse stale deliveries: replay protection.
  return Math.abs(Date.now() - Number(headers["x-oi-timestamp"]) * 1000) < 5 * 60_000;
}
```

Failures are retried three times, listed with their status, and can be resent by hand; an endpoint failing for seven days is disabled. Webhooks fire after the database commit, never inside it.

## The catalog importer

A CLI that reads Backstage, a `catalog-info.yaml`, a file or a command and talks to `POST /catalog/import` — described in [Catalog](catalog#the-importer-cli).

## What is not in the API

Members, roles and settings are managed from the product (and, for members, through SCIM in the enterprise edition). Alerts arrive through the alert sources' own ingest endpoints, not through the API keys.
