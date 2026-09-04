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
