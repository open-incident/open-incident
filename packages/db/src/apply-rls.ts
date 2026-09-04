/**
 * Makes tenant isolation REAL: creates the application role, grants it what the
 * product needs, and applies sql/rls.sql. Runs as the database owner
 * (DATABASE_ADMIN_URL), idempotently — after every migration.
 *
 * Why a role of its own: PostgreSQL lets a table's owner through its own
 * row-level security. A product that connects as the owner has policies in the
 * catalogue and none in effect — which is exactly how a previous product
 * shipped, README and all. The isolation test in test/isolation.test.ts runs
 * with DATABASE_URL and fails the day someone points it at the owner again.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

const adminUrl =
  process.env.DATABASE_ADMIN_URL ??
  process.env.DATABASE_URL ??
  "postgres://openincident:openincident@localhost:5441/openincident";
const appRole = process.env.APP_DB_ROLE ?? "openincident_app";
const appPassword = process.env.APP_DB_PASSWORD ?? "openincident_app";

if (!/^[a-z_][a-z0-9_]*$/.test(appRole)) {
  throw new Error(`APP_DB_ROLE must be a plain identifier, got "${appRole}"`);
}

// `drop policy if exists` raises a NOTICE per table on the first run; it is not news.
const sql = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} });
const policies = readFileSync(new URL("../sql/rls.sql", import.meta.url), "utf8");

try {
  // Trigram similarity — the anti-duplicate hint at declaration. An extension
  // is the owner's to create, which is why it lives here and not in a migration
  // the application role could never run.
  await sql.unsafe(`create extension if not exists pg_trgm`);

  // The role — created once, password kept in step with the environment.
  await sql.unsafe(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = '${appRole}') then
        create role ${appRole} login password '${appPassword.replace(/'/g, "''")}';
      else
        alter role ${appRole} with login password '${appPassword.replace(/'/g, "''")}';
      end if;
    end $$;
  `);

  // What the product may touch. `directory` is read-only: provisioning writes
  // it, the product never does. `auth` is Better Auth's — global, no tenant
  // column, hence no policy; `app` is where the policies apply.
  await sql.unsafe(`
    grant usage on schema directory, auth, app to ${appRole};
    grant select on all tables in schema directory to ${appRole};
    grant insert, delete on directory.api_key_lookup to ${appRole};
grant select, insert, update, delete on directory.status_snapshots to ${appRole};
    grant select, insert, update, delete on all tables in schema auth, app to ${appRole};
    grant usage, select on all sequences in schema auth, app to ${appRole};
    alter default privileges in schema directory grant select on tables to ${appRole};
    alter default privileges in schema auth grant select, insert, update, delete on tables to ${appRole};
    alter default privileges in schema app grant select, insert, update, delete on tables to ${appRole};
    alter default privileges in schema auth grant usage, select on sequences to ${appRole};
    alter default privileges in schema app grant usage, select on sequences to ${appRole};
  `);

  await sql.unsafe(policies);
  const rows = await sql<{ n: string }[]>`
    select count(*)::text as n from pg_policies where schemaname = 'app' and policyname = 'tenant_isolation'`;
  console.log(
    `RLS applied: role ${appRole} ready, ${rows[0]?.n ?? "0"} app tables under tenant_isolation.`,
  );
} finally {
  await sql.end();
}
