-- The catalog is removed from the product. Its two tables go, and with them
-- every column that pointed at one.
--
-- The order matters twice. Foreign keys and columns come before the tables,
-- because dropping a table cascades its keys and a later statement naming them
-- would fail on constraints that no longer exist. The enum comes last, because
-- a column of one of those tables still uses it until the table is gone.
--
-- Every link these columns carried was copied to `service_id` by 0028, and on
-- the workspace this was written against not one row was left behind. What a
-- catalog held beyond services and teams — custom types, their entries — has
-- no counterpart and is deleted. That is the point of the change, and the
-- release note says so rather than letting someone find out.
ALTER TABLE "app"."change_events" DROP CONSTRAINT IF EXISTS "change_events_service_entry_id_catalog_entries_id_fk";--> statement-breakpoint
ALTER TABLE "app"."follow_ups" DROP CONSTRAINT IF EXISTS "follow_ups_assignee_team_entry_id_catalog_entries_id_fk";--> statement-breakpoint
ALTER TABLE "app"."heartbeats" DROP CONSTRAINT IF EXISTS "heartbeats_service_entry_id_catalog_entries_id_fk";--> statement-breakpoint
ALTER TABLE "app"."incident_fields" DROP CONSTRAINT IF EXISTS "incident_fields_catalog_type_id_catalog_types_id_fk";--> statement-breakpoint
ALTER TABLE "app"."incidents" DROP CONSTRAINT IF EXISTS "incidents_service_entry_id_catalog_entries_id_fk";--> statement-breakpoint
ALTER TABLE "app"."runbooks" DROP CONSTRAINT IF EXISTS "runbooks_service_entry_id_catalog_entries_id_fk";--> statement-breakpoint
ALTER TABLE "app"."status_page_components" DROP CONSTRAINT IF EXISTS "status_page_components_service_entry_id_catalog_entries_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "app"."runbooks_tenant_service";--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runbooks_tenant_service" ON "app"."runbooks" USING btree ("tenant_id","service_id");--> statement-breakpoint
ALTER TABLE "app"."ai_settings" ALTER COLUMN "sources" SET DEFAULT '{"services":true,"incidents":true,"changeEvents":true,"docs":false}'::jsonb;--> statement-breakpoint
ALTER TABLE "app"."change_events" DROP COLUMN IF EXISTS "service_entry_id";--> statement-breakpoint
ALTER TABLE "app"."follow_ups" DROP COLUMN IF EXISTS "assignee_team_entry_id";--> statement-breakpoint
ALTER TABLE "app"."heartbeats" DROP COLUMN IF EXISTS "service_entry_id";--> statement-breakpoint
ALTER TABLE "app"."incident_fields" DROP COLUMN IF EXISTS "catalog_type_id";--> statement-breakpoint
ALTER TABLE "app"."incidents" DROP COLUMN IF EXISTS "service_entry_id";--> statement-breakpoint
ALTER TABLE "app"."runbooks" DROP COLUMN IF EXISTS "service_entry_id";--> statement-breakpoint
ALTER TABLE "app"."status_page_components" DROP COLUMN IF EXISTS "service_entry_id";--> statement-breakpoint
DROP TABLE IF EXISTS "app"."catalog_entries" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "app"."catalog_types" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "app"."catalog_source";
