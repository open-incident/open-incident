# Contributing to Open Incident

Thanks for your interest! Open Incident is an open-core incident management
platform: the core is AGPL-3.0, the `ee/` directory is commercially licensed
(see `ee/LICENSE`).

## Development setup

```bash
corepack enable                 # pnpm is pinned in package.json
pnpm install
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d   # postgres, redis, mailpit
pnpm db:migrate                 # schema (runs as the database owner)
pnpm db:rls                     # application role + row-level security
pnpm db:seed && pnpm db:seed:auth                   # demo workspace "Skylark Systems"
pnpm dev
```

Then open http://skylark.localhost:3100 — demo login `amelie@skylark.dev` /
`demo-openincident`. Development emails are captured by Mailpit
(http://localhost:8027).

## Before you open a pull request

- `pnpm typecheck` must pass — this includes the strict parity check across the
  translation dictionaries (`apps/web/src/i18n/`, English is the source).
- `pnpm build` and `pnpm lint` must pass.
- `pnpm test` runs the unit and integration tests (the tenant isolation test
  needs the Postgres of `docker/docker-compose.yml`).
- For user-facing changes, run the end-to-end suite:
  `pnpm --filter @openincident/smoke smoke` (see `packages/smoke/README.md`
  for the prerequisites).
- Any user-visible string must live in the i18n dictionaries — hardcoded text
  fails the `i18n-hardcoded` guard in `packages/smoke/`.

## Scope of contributions

- **Core (everything outside `ee/`)**: contributions welcome — bug fixes,
  features from the roadmap (see the README), translations, documentation.
- **`ee/`**: commercially licensed; contributions are by invitation. By
  submitting changes to `ee/`, you agree they are assigned to the copyright
  holder (see `ee/LICENSE`).

## Developer Certificate of Origin

Contributions are accepted under the [DCO](https://developercertificate.org/).
Sign your commits with `git commit -s` (adds a `Signed-off-by` line) to certify
that you have the right to submit the code under the project license.

## Conventions

- One topic per pull request, with a clear description of the user-visible
  behaviour it changes.
- Match the surrounding code: server components + server actions, guards
  duplicated on page and action, every query on the `app` schema inside
  `withTenant()`, comments in English explaining the _why_.
- A screen only merges when its action acts. A control the back end does not
  honour yet is shown as an explicit "soon" label, never as a dead button.
