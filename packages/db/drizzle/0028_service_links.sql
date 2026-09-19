ALTER TABLE "app"."change_events" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."heartbeats" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."runbooks" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."status_page_components" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."change_events" ADD CONSTRAINT "change_events_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."heartbeats" ADD CONSTRAINT "heartbeats_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."runbooks" ADD CONSTRAINT "runbooks_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_components" ADD CONSTRAINT "status_page_components_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Carrying the link over from the catalog.
--
-- A catalog entry of type `service` and an observed service describe the same
-- thing under the same name, so the match is on the name and scoped to the
-- workspace. A row whose entry has no counterpart keeps a null service and
-- says so on screen rather than pointing at the wrong one.
UPDATE "app"."status_page_components" AS c
SET "service_id" = s."id"
FROM "app"."catalog_entries" AS e, "app"."services" AS s
WHERE c."service_entry_id" = e."id"
  AND s."tenant_id" = c."tenant_id"
  AND lower(s."key") = lower(e."name")
  AND c."service_id" IS NULL;--> statement-breakpoint
UPDATE "app"."change_events" AS c
SET "service_id" = s."id"
FROM "app"."catalog_entries" AS e, "app"."services" AS s
WHERE c."service_entry_id" = e."id"
  AND s."tenant_id" = c."tenant_id"
  AND lower(s."key") = lower(e."name")
  AND c."service_id" IS NULL;--> statement-breakpoint
UPDATE "app"."heartbeats" AS h
SET "service_id" = s."id"
FROM "app"."catalog_entries" AS e, "app"."services" AS s
WHERE h."service_entry_id" = e."id"
  AND s."tenant_id" = h."tenant_id"
  AND lower(s."key") = lower(e."name")
  AND h."service_id" IS NULL;--> statement-breakpoint
UPDATE "app"."runbooks" AS r
SET "service_id" = s."id"
FROM "app"."catalog_entries" AS e, "app"."services" AS s
WHERE r."service_entry_id" = e."id"
  AND s."tenant_id" = r."tenant_id"
  AND lower(s."key") = lower(e."name")
  AND r."service_id" IS NULL;--> statement-breakpoint
-- Team memberships, for an instance upgrading with a catalog it filled by hand.
-- The seed already writes them; this is for everyone else.
INSERT INTO "app"."team_members" ("tenant_id", "team_id", "member_id")
SELECT t."tenant_id", t."id", (m.value #>> '{}')::uuid
FROM "app"."catalog_entries" AS e
JOIN "app"."catalog_types" AS ct ON ct."id" = e."type_id" AND ct."key" = 'team'
JOIN "app"."teams" AS t ON t."tenant_id" = e."tenant_id" AND lower(t."name") = lower(e."name")
CROSS JOIN LATERAL jsonb_array_elements(coalesce(e."attributes" -> 'members', '[]'::jsonb)) AS m(value)
WHERE jsonb_typeof(e."attributes" -> 'members') = 'array'
  AND EXISTS (SELECT 1 FROM "app"."members" mm WHERE mm."id" = (m.value #>> '{}')::uuid)
ON CONFLICT DO NOTHING;
