# @openincident/db

PostgreSQL schema (Drizzle ORM), three schemas:

- `directory` — `tenants`: the one table read before a tenant context exists
  (host → workspace). Read-only for the application role; provisioning writes it.
- `auth` — Better Auth's tables. Global: one identity, several workspaces.
- `app` — the product. Every table carries `tenant_id` and sits under
  row-level security.

## Getting started

```bash
docker compose -f ../../docker/docker-compose.yml up -d postgres
pnpm db:generate   # generates the SQL migrations into ./drizzle (as the owner)
pnpm db:migrate    # applies them (DATABASE_ADMIN_URL)
pnpm db:rls        # creates the application role, grants, policies — idempotent
pnpm db:seed       # frozen demo data set (Skylark Systems, INC-217)
pnpm test          # includes the isolation test, which needs the database
```

## Rules

- **The application connects as a role that does not own the tables.** An owner
  bypasses its own policies; `db:rls` creates `openincident_app` and grants it
  exactly what the product needs. `DATABASE_URL` is that role;
  `DATABASE_ADMIN_URL` is the owner, for migrations, `db:rls`, seeds and the
  `workspace:create` command.
- **Every query on `app` runs inside `withTenant(tenantId, tx => …)`.** The
  package exports no raw client to the apps: outside the context the policies
  return nothing and accept nothing.
- Re-run `pnpm db:rls` after any migration that creates a table.
- `test/isolation.test.ts` proves the mechanism, not a sample: it reads across
  two workspaces and expects nothing back, and fails if `DATABASE_URL` is the
  owner.
