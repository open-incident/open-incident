# End-to-end smoke test

Replays the product's journeys against an instance that really runs — its
database, its SMTP, its sessions. It catches the class of defect no type
system sees: a saved setting nobody reads, a redirect that loses the
subdomain, a role guard that only exists in the interface, a control that is
drawn but inert.

## Before you run

```bash
docker compose -f docker/docker-compose.yml up -d           # Postgres, Redis, Mailpit
pnpm db:migrate && pnpm db:rls && pnpm db:seed && pnpm db:seed:auth
pnpm --filter @openincident/web build
BASE_DOMAIN=localhost:3106 SMTP_HOST=localhost SMTP_PORT=1027 SMTP_SECURE=false \
  pnpm --filter @openincident/web exec next start --port 3106
pnpm --filter @openincident/worker start                    # the outbox needs it
```

Without the `BASE_DOMAIN` ↔ port match, the middleware resolves no workspace
and **everything answers 404**: the first trap of the local environment.

## Run

```bash
pnpm --filter @openincident/smoke smoke          # the suite
SMOKE_HEADED=1 pnpm --filter @openincident/smoke smoke   # visible browser
```

Variables: `SMOKE_PORT` (3106), `SMOKE_HOST`, `SMOKE_BASE_URL`, `SMOKE_TENANT`
(skylark), `SMOKE_MAILPIT_URL` (http://localhost:8027).

**`SMOKE_BASE_URL` must name the workspace's own host**, not the apex. A
workspace lives on `<slug>.<host>` and its session cookie with it; point the
suite at the apex and most specs still pass, because they never leave it. The
ones that do — the Slack OAuth round trip returns from the identity provider to
the _workspace_ origin — lose the session on the way back and land on `/login`,
which reads as a broken product and is a broken invocation:

```bash
# Against a local stack behind TLS, with the workspace that owns the data:
SMOKE_TENANT=skylark \
SMOKE_BASE_URL=https://skylark.oi.localhost:3106 \
SMOKE_STATUS_BASE_URL=https://skylark.status.oi.localhost:3107 \
NODE_TLS_REJECT_UNAUTHORIZED=0 \
  pnpm --filter @openincident/smoke smoke
```

The Slack and Teams specs additionally need the server started with the mock
credentials and `SLACK_ALLOW_LOCAL_ENDPOINT=1`, which is what the CI workflow
does — the OAuth start route otherwise refuses to send anybody to a loopback
address.

## What is covered

| File             | Journey                                                                           |
| ---------------- | --------------------------------------------------------------------------------- |
| `tenancy`        | Ghost and reserved subdomains answer 404; the real one serves its own sign-in     |
| `auth`           | Sign-in/out, wrong password, forgot → email → reset, viewer refused on settings   |
| `members`        | Invite → email → accept → sign in → disable → refused                             |
| `incidents`      | INC-217 detail, declare + update, viewer cannot declare                           |
| `i18n-source`    | Plural tables, vocabulary sets, action verbs of the dictionaries — **no browser** |
| `i18n-hardcoded` | No translatable text lives outside `i18n/` — **no browser**                       |

## Writing rules

1. **Never wait for a duration**, wait for a signal from the product: a URL, an
   element, an HTTP status. For anything that takes time, `expect(...).toPass()`.
2. **`getByText` also matches the content of a `<textarea>`.** Check the result
   where it counts, never the state of the input field.
3. **The demo workspace is shared.** Tests create their own throwaway members
   and incidents (prefixed `smoke`) and never edit the seeded ones.
