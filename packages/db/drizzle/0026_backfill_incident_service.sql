-- Catching up `incidents.service_id` on the incidents declared before the
-- shared write path carried it.
--
-- The two models name the same thing: a catalog entry called `checkout-api`
-- and an observed service keyed `checkout-api`. Matching on the name is
-- therefore exact, not a guess — and it is scoped to the tenant, so two
-- workspaces that both run a `checkout-api` never borrow each other's.
UPDATE "app"."incidents" AS i
SET "service_id" = s."id"
FROM "app"."catalog_entries" AS e, "app"."services" AS s
WHERE i."service_entry_id" = e."id"
  AND s."tenant_id" = i."tenant_id"
  AND lower(s."key") = lower(e."name")
  AND i."service_id" IS NULL;
