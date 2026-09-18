ALTER TABLE "app"."incidents" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_service_id_services_id_fk"
  FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "incidents_tenant_service" ON "app"."incidents" ("tenant_id","service_id");--> statement-breakpoint
-- Every service the catalogue already knows becomes a first-class one, keeping
-- its owner: a workspace that filled a catalogue does not start over.
INSERT INTO "app"."services" ("tenant_id", "key", "name", "confirmed", "seen_in", "last_seen_at")
SELECT e."tenant_id", lower(e."name"), e."name", true, '["catalog"]'::jsonb, now()
FROM "app"."catalog_entries" e
JOIN "app"."catalog_types" t ON t."id" = e."type_id"
WHERE t."key" = 'service'
ON CONFLICT ("tenant_id", "key") DO NOTHING;--> statement-breakpoint
INSERT INTO "app"."teams" ("tenant_id", "name")
SELECT e."tenant_id", e."name"
FROM "app"."catalog_entries" e
JOIN "app"."catalog_types" t ON t."id" = e."type_id"
WHERE t."key" = 'team'
ON CONFLICT ("tenant_id", "name") DO NOTHING;--> statement-breakpoint
-- The owner link the catalogue carried in its attributes.
UPDATE "app"."services" s
SET "owner_team_id" = tm."id"
FROM "app"."catalog_entries" e
JOIN "app"."catalog_types" t ON t."id" = e."type_id"
JOIN "app"."catalog_entries" owner ON owner."id" = (e."attributes" ->> 'owner')::uuid
JOIN "app"."teams" tm ON tm."tenant_id" = e."tenant_id" AND tm."name" = owner."name"
WHERE t."key" = 'service'
  AND s."tenant_id" = e."tenant_id"
  AND s."key" = lower(e."name")
  AND e."attributes" ->> 'owner' ~ '^[0-9a-f-]{36}$';--> statement-breakpoint
-- Incidents keep pointing at the same service, now by its own id.
UPDATE "app"."incidents" i
SET "service_id" = s."id"
FROM "app"."catalog_entries" e
JOIN "app"."services" s ON s."tenant_id" = e."tenant_id" AND s."key" = lower(e."name")
WHERE i."service_entry_id" = e."id" AND i."service_id" IS NULL;
