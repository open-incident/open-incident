---
title: Install and configure
section: getting-started
order: 2
summary: From a clone to a running instance in three commands, then every variable the instance reads and the commands an operator runs.
---

## Prerequisites

- A Linux host with Docker Engine 24+ and Docker Compose v2. Two CPUs and 4 GB of RAM run a small instance comfortably; the database is the part that grows.
- A domain you control. Every workspace answers on a subdomain (`acme.your-domain.example`), so plan a **wildcard DNS record** (`*.your-domain.example`) and a wildcard or per-subdomain TLS certificate at your reverse proxy. A single-workspace instance can live on the bare domain instead (see `DEFAULT_TENANT_SLUG`).
- An SMTP relay, or an account with Resend, Brevo or Mailjet. Email carries invitations, password resets, on-call pages and status page notifications; without a transport, emails are written to the server logs and nothing reaches anyone.

## The three commands

```bash
git clone https://github.com/Open-Incident/open-incident && cd open-incident
cp .env.example .env        # then set BETTER_AUTH_SECRET, ENCRYPTION_KEY, APP_DB_PASSWORD
docker compose up -d        # http://localhost:3000 — status pages on http://<page>.status.localhost:3001
```

`compose.yaml` at the repository root builds and starts five services:

| Service    | Role                                                                                                                                                                             | Port                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `postgres` | The database (PostgreSQL 17).                                                                                                                                                    | internal               |
| `redis`    | The queues of the worker (BullMQ).                                                                                                                                               | internal               |
| `migrate`  | Runs the schema migrations, creates the application role and its row-level security, seeds the demo workspace when `SEED_DEMO=true`, then exits. The other services wait for it. | —                      |
| `web`      | The product.                                                                                                                                                                     | `3000` (`WEB_PORT`)    |
| `status`   | The public status pages — a separate, minimal app that reads snapshots only.                                                                                                     | `3001` (`STATUS_PORT`) |
| `worker`   | Background jobs: the mail outbox, escalation ticks, reminders, sweeps, syncs.                                                                                                    | —                      |

An optional `minio` service (`docker compose --profile storage up -d`) provides an S3-compatible bucket for workspace files.

Without `BASE_DOMAIN` and `STATUS_BASE_DOMAIN` in `.env`, the stack answers on `localhost:3000` and `status.localhost:3001`. For a real deployment set them to your domains before the first start — every link the product writes (emails, callbacks, status page addresses) is built from them.

Generate the three secrets before the first start:

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET — signs sessions
openssl rand -base64 32   # ENCRYPTION_KEY — encrypts integration tokens at rest
openssl rand -hex 16      # APP_DB_PASSWORD — the application's database role
```

> The database has two roles on purpose. The owner (`POSTGRES_USER`) runs migrations and seeds; the application connects as `openincident_app`, a role that does not own the tables — that is what makes row-level security effective. Never point `DATABASE_URL` at the owner.

## First sign-in

With `SEED_DEMO=true` the instance starts with the **Skylark Systems** demo workspace on `skylark.<BASE_DOMAIN>` (and on the bare domain, since `DEFAULT_TENANT_SLUG=skylark`). Sign in as `amelie@skylark.dev` / `demo-openincident`. Open **Settings → Members & roles** to see the roles at work, **Incidents → INC-217** for a complete history, **On-call** for a running rotation.

## Your own workspace

Create it with the owner's invitation link printed at the end:

```bash
docker compose run --rm migrate pnpm workspace:create -- \
  --slug acme --name "Acme Corp" \
  --owner-email jane@acme.example --owner-name "Jane Doe" \
  --locale en --timezone Europe/Paris
```

The slug is 3–40 lowercase letters, digits and hyphens, and not a reserved subdomain (`www`, `api`, `status`, `mail`, `admin`… — the full list is in `packages/config`). The workspace answers on `acme.<BASE_DOMAIN>` at once. Open the printed link to set the owner's password, then set `SEED_DEMO=false` in `.env` and remove the demo workspace with the purge command (see [Operations](operations)).

On a single-workspace instance set `DEFAULT_TENANT_SLUG=acme` so the bare domain serves it.

## The reverse proxy

Terminate TLS in front of `web` and `status` and forward the `Host` header unchanged; the product resolves the workspace from it. Send `X-Forwarded-Host` and `X-Forwarded-Proto` too — every reverse proxy does, and the product reads them to build the links it puts in emails and callbacks.

| Host                                                                                    | Forward to    |
| --------------------------------------------------------------------------------------- | ------------- |
| `your-domain.example`, `*.your-domain.example`                                          | `web:3000`    |
| `status.your-domain.example`, `*.status.your-domain.example`, customers' custom domains | `status:3001` |

The status app issues nothing itself: a customer's custom domain is a CNAME to `status.<your domain>`, and your proxy obtains its certificate on first visit (Caddy and Traefik do this on demand).

**Ask before issuing.** On-demand certificates without a filter are an open door: any hostname pointed at your IP would make your proxy request a certificate in your name, until the certificate authority's rate limits stop you. The status app answers that question at `GET /api/tls?domain=<hostname>` — `200` for a domain a published page actually carries (the snapshot records one only after its DNS is verified), `404` for anything else. Wire it as the proxy's gate:

```caddyfile
{
	on_demand_tls {
		ask http://status:3001/api/tls
	}
}

# Every host your own certificates do not cover: the customers' domains.
:443 {
	tls {
		on_demand
	}
	reverse_proxy status:3001
}
```

Set `STATUS_TLS_ASK_KEY` and add `?key=…` to the ask URL when the endpoint is reachable from outside your network; the proxy is the only caller that needs it.

## Environment reference

Every variable the instance reads, grouped as in `.env.example`. Variables marked _instance-wide_ are set once by the operator; what is _per workspace_ is configured in the product's settings.

### Core

| Variable                  | Meaning                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SEED_DEMO`               | `true` installs the demo workspace on the first start. Set to `false` once yours exists.                                                                                                          |
| `OPENINCIDENT_EDITION`    | `self-hosted` (default) or `cloud`. Read server-side only.                                                                                                                                        |
| `OI_ENTITLEMENTS`         | Enterprise capabilities switched on for a standalone install, comma-separated: `sso`, `customRoles`, `auditLogAdvanced`, `customerStatusPages`. See [Enterprise edition](enterprise).             |
| `SSO_TRUSTED_IDP_ORIGINS` | Origins of identity providers on private addresses (an internal Keycloak). The SSO plugin refuses non-public hosts otherwise.                                                                     |
| `DATABASE_URL`            | The application role's connection string.                                                                                                                                                         |
| `DATABASE_ADMIN_URL`      | The owner's connection string, for migrations, `db:rls`, seeds and the purge.                                                                                                                     |
| `APP_DB_PASSWORD`         | The password `db:rls` gives the application role when it creates it.                                                                                                                              |
| `REDIS_URL`               | The queues.                                                                                                                                                                                       |
| `BASE_DOMAIN`             | `{slug}.$BASE_DOMAIN` → workspace; every link the product writes is built from it. Unset: `localhost:3100` in development, `localhost:3000` in the compose stack. Your real domain in production. |
| `DEFAULT_TENANT_SLUG`     | The workspace served on the bare domain.                                                                                                                                                          |
| `INTERNAL_WEB_ORIGIN`     | Where the worker reaches the web app to post heartbeat alerts (`http://web:3000` in the compose stack).                                                                                           |

### Authentication

| Variable                                                  | Meaning                                                                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                                      | Signs sessions. 32 random bytes at least.                                                                               |
| `BETTER_AUTH_URL`                                         | Pins the auth base URL. Leave unset: it is derived from each workspace host and checked against `BASE_DOMAIN`.          |
| `AUTH_COOKIE_DOMAIN`                                      | Control-plane deployments: one session cookie across `www.` and the workspace subdomains.                               |
| `REQUIRE_EMAIL_VERIFICATION`                              | `true` refuses sign-in until the address is confirmed (implies the mail below).                                         |
| `SEND_EMAIL_VERIFICATION`                                 | Sends the confirmation mail without gating sign-in on it.                                                               |
| `EMAIL_VERIFICATION_DEADLINE_DAYS`                        | Named in that mail.                                                                                                     |
| `GOOGLE_CLIENT_ID` / `_SECRET`, `MICROSOFT_…`, `GITHUB_…` | Each pair switches its social sign-in button on. Redirect URI: `https://<workspace host>/api/auth/callback/<provider>`. |
| `ENCRYPTION_KEY`                                          | Encrypts integration tokens and provider secrets at rest.                                                               |
| `SIGNUP_URL`                                              | Control plane: where the "workspace not found" page sends a visitor.                                                    |

### Email

| Variable                                                                    | Meaning                                              |
| --------------------------------------------------------------------------- | ---------------------------------------------------- |
| `MAIL_FROM`                                                                 | The sender address.                                  |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`       | Any relay.                                           |
| `RESEND_API_KEY`, `BREVO_API_KEY`, `MAILJET_API_KEY` + `MAILJET_API_SECRET` | Native APIs; the first one filled in wins over SMTP. |

### On-call notifications

| Variable                                                                   | Meaning                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `WEBPUSH_VAPID_PUBLIC_KEY`, `WEBPUSH_VAPID_PRIVATE_KEY`, `WEBPUSH_SUBJECT` | Web push. Generate a pair with `pnpm --filter @openincident/oncall exec tsx src/vapid.ts`. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`                   | SMS and voice calls (E.164 sender). Voice acknowledges with the key **4**.                 |

Without a provider, the channel is shown as unavailable in every member's notification rules — and never silently skipped.

### Chat

| Variable                                                                                                      | Meaning                                                                |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`                                              | One Slack app per instance. See [Slack](slack) for the app manifest.   |
| `SLACK_REDIRECT_URI`                                                                                          | Optional fixed OAuth redirect (one callback host for every workspace). |
| `TEAMS_APP_ID`, `TEAMS_APP_SECRET`                                                                            | One Azure bot registration per instance. See [Microsoft Teams](teams). |
| `SLACK_API_BASE`, `TEAMS_LOGIN_BASE`, `TEAMS_GRAPH_BASE`, `TEAMS_OPENID_CONFIG`, `TEAMS_SERVICE_URL_OVERRIDE` | Test and proxy overrides; leave empty.                                 |

### Status pages

| Variable              | Meaning                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STATUS_BASE_DOMAIN`  | Pages answer on `{slug}.$STATUS_BASE_DOMAIN`. Unset: `status.localhost:3107` in development, `status.localhost:3001` in the compose stack. In production, the domain your proxy sends to the status app. |
| `STATUS_DEFAULT_PAGE` | Single-page instance: the page served on the bare status domain.                                                                                                                                         |

### Assistant

| Variable                                | Meaning                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `AI_API_BASE`, `AI_API_KEY`, `AI_MODEL` | Any OpenAI-compatible endpoint: Mistral La Plateforme, an EU-region deployment, a self-hosted Ollama or vLLM. |
| `AI_EMBED_MODEL`                        | Embeddings for "similar incidents" by meaning; without it, similarity falls back to titles and says so.       |
| `AI_PROVIDER_LABEL`                     | The name shown in **Settings → AI governance**.                                                               |

Without `AI_API_BASE` and `AI_MODEL`, every assistant function is shown as unavailable. See [The assistant](ai).

### Object storage

| Variable                                                                                                   | Meaning                                                                                            |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | Workspace files (logos). All five or none: a partial set stops the process at startup, on purpose. |

### Trackers and documentation tools

`GITHUB_API_BASE`, `GITLAB_API_BASE`, `JIRA_API_BASE`, `LINEAR_API_BASE`, `CONFLUENCE_API_BASE`, `NOTION_API_BASE` override the vendors' hosts for tests and proxies. Credentials themselves are entered per workspace in **Settings → Integrations**.

## Upgrading

```bash
git pull
docker compose build
docker compose up -d      # migrate runs the new migrations, then web/status/worker restart
```

Migrations are forward-only and run by the `migrate` service before the others start. Read `CHANGELOG.md` for what a release changes; a new environment variable is always listed there and in `.env.example`.

## Backups

Everything a workspace owns is in PostgreSQL, plus the object storage prefix `tenants/<tenant id>/` when logos were uploaded. A nightly `pg_dump` of the database and a copy of the bucket are a complete backup. Redis holds only queued jobs and can be lost: a page that was queued and not sent is written to the outbox with the status `failed` and is visible in the member's notifications.

## Development setup

For contributors, the development stack runs on shifted host ports so it coexists with other local projects:

```bash
corepack enable
pnpm install
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d   # postgres 5441, redis 6381, mailpit 1027/8027, minio 9100
pnpm db:migrate && pnpm db:rls
pnpm db:seed && pnpm db:seed:auth
pnpm dev                                            # http://skylark.localhost:3100
```

Mailpit at `http://localhost:8027` captures every email. `CONTRIBUTING.md` lists the checks a change must pass; `packages/smoke/README.md` explains the end-to-end suite, which runs against a throwaway workspace and purges it afterwards.
