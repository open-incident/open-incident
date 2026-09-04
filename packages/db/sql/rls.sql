-- Row-level security — tenant isolation on the app schema.
-- Applied by `pnpm db:rls` (src/apply-rls.ts) after every migration; idempotent.
--
-- The application connects as a role that does NOT own the tables: an owner
-- bypasses its own policies. apply-rls.ts creates that role (see there for the
-- password) and grants it what the product needs — this file only holds the
-- policies, which are the same for every table.
--
-- The tenant context is set by withTenant():
--   select set_config('app.tenant_id', '<uuid>', true);
-- Outside it the setting is NULL — or '' once a connection has set it before,
-- which is why the policy goes through nullif(): '' cast to uuid would throw,
-- and a policy that throws is a query that fails instead of one that returns
-- nothing. Either way nothing gets through — no row read, no row written.

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'app'
  loop
    execute format('alter table app.%I enable row level security', t);
    -- idempotent: drop, then recreate
    execute format('drop policy if exists tenant_isolation on app.%I', t);
    execute format(
      $f$create policy tenant_isolation on app.%I
        using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
        with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$f$,
      t
    );
  end loop;
end $$;
