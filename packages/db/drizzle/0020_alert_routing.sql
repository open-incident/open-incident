CREATE TABLE "app"."alert_attributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'text' NOT NULL,
	"catalog_type_key" text,
	"required" boolean DEFAULT false NOT NULL,
	"merge_strategy" text DEFAULT 'last' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."alert_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"alert_id" uuid NOT NULL,
	"member_id" uuid,
	"member_name" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."alert_priorities" ADD COLUMN "aliases" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."alert_priorities" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."alert_routes" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "app"."alert_routes" ADD COLUMN "source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."alert_routes" ADD COLUMN "conditions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."alert_routes" ADD COLUMN "escalations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."alert_routes" ADD COLUMN "incident" jsonb;--> statement-breakpoint
ALTER TABLE "app"."alert_routes" ADD COLUMN "grouping" jsonb;--> statement-breakpoint
ALTER TABLE "app"."alert_routes" ADD COLUMN "notify" jsonb;--> statement-breakpoint
ALTER TABLE "app"."alert_sources" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "app"."alert_sources" ADD COLUMN "priority_rule" jsonb;--> statement-breakpoint
ALTER TABLE "app"."alert_sources" ADD COLUMN "filter" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."alerts" ADD COLUMN "group_key" text;--> statement-breakpoint
ALTER TABLE "app"."alert_attributes" ADD CONSTRAINT "alert_attributes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alert_notes" ADD CONSTRAINT "alert_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alert_notes" ADD CONSTRAINT "alert_notes_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "app"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alert_notes" ADD CONSTRAINT "alert_notes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_attributes_tenant_key" ON "app"."alert_attributes" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "alert_notes_alert" ON "app"."alert_notes" USING btree ("alert_id");--> statement-breakpoint
-- Existing routes, read in today's terms: filters as one AND group, the escalation mode as a
-- rule, the incident mode as a template, grouping as the five-minute service window it was.
UPDATE "app"."alert_routes" SET "conditions" = jsonb_build_array(jsonb_build_object('all', "filters")) WHERE jsonb_array_length("filters") > 0 AND jsonb_array_length("conditions") = 0;--> statement-breakpoint
UPDATE "app"."alert_routes" SET "escalations" = CASE
  WHEN "escalation_mode" = 'static' AND "escalation_path_id" IS NOT NULL THEN jsonb_build_array(jsonb_build_object('kind', 'path', 'pathId', "escalation_path_id"))
  WHEN "escalation_mode" = 'dynamic' THEN jsonb_build_array(jsonb_build_object('kind', 'attribute', 'attribute', 'service', 'fallbackPathId', "escalation_path_id"))
  ELSE '[]'::jsonb END
WHERE jsonb_array_length("escalations") = 0;--> statement-breakpoint
UPDATE "app"."alert_routes" SET "incident" = jsonb_build_object(
  'mode', "incident_mode", 'typeId', "incident_type_id",
  'startPhase', CASE WHEN "incident_mode" = 'always' THEN 'active' ELSE 'triage' END,
  'severity', CASE WHEN "incident_mode" = 'always' THEN jsonb_build_object('mode', 'priority') ELSE jsonb_build_object('mode', 'none') END,
  'visibility', 'public', 'customFields', jsonb_build_object('region', 'region'), 'declineOnResolve', false)
WHERE "incident" IS NULL;--> statement-breakpoint
UPDATE "app"."alert_routes" SET "grouping" = jsonb_build_object('enabled', true, 'by', jsonb_build_array('service'), 'windowMinutes', 5, 'extending', false, 'escalate', 'never', 'graceMinutes', 0) WHERE "grouping" IS NULL;--> statement-breakpoint
-- Every workspace gets the attribute vocabulary its routes speak.
INSERT INTO "app"."alert_attributes" ("tenant_id", "key", "label", "type", "catalog_type_key", "position")
SELECT t."id", v.key, v.label, v.type, v.ctk, v.pos FROM "directory"."tenants" t
CROSS JOIN (VALUES ('service', 'Service', 'catalog', 'service', 0), ('team', 'Team', 'catalog', 'team', 1), ('environment', 'Environment', 'text', NULL, 2), ('region', 'Region', 'text', NULL, 3), ('severity', 'Tool severity', 'text', NULL, 4)) AS v(key, label, type, ctk, pos)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- The second priority (P2 by convention) is the default where none was chosen.
UPDATE "app"."alert_priorities" p SET "is_default" = true WHERE p."rank" = 1 AND NOT EXISTS (SELECT 1 FROM "app"."alert_priorities" q WHERE q."tenant_id" = p."tenant_id" AND q."is_default");--> statement-breakpoint
-- The team's escalation path becomes a validated reference; existing names still resolve.
UPDATE "app"."catalog_types" SET "attributes" = (SELECT jsonb_agg(CASE WHEN a->>'key' = 'escalation_path' THEN a || '{"type":"escalation_path"}'::jsonb ELSE a END) FROM jsonb_array_elements("attributes") a) WHERE "key" = 'team' AND "attributes" @> '[{"key":"escalation_path"}]'::jsonb;
