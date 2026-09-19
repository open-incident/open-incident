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

-- One table owns rows that belong to no workspace. `probes.tenant_id` is
-- nullable on purpose: a probe run by the instance is shared by every
-- workspace, and `NULL = uuid` is never true, so the policy below would hide
-- those rows from the application for ever. The exception reads them and
-- refuses to write them: a workspace sees the instance's probes and can only
-- create its own.
do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'app' and tablename <> 'probes'
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

alter table app.probes enable row level security;
drop policy if exists tenant_isolation on app.probes;
create policy tenant_isolation on app.probes
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- A second permissive policy, on reads only. Postgres OR-s permissive policies
-- of the same command, so a workspace selects its own probes and the
-- instance's; nothing else changes, because an update or a delete never
-- consults a policy written `for select`.
drop policy if exists instance_probes_readable on app.probes;
create policy instance_probes_readable on app.probes for select using (tenant_id is null);
