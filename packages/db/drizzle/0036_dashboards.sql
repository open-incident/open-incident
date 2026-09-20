CREATE TABLE "app"."dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"layout" jsonb DEFAULT '{"panels":[]}'::jsonb NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"public_token" text,
	"imported_from" text,
	"import_report" jsonb,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory"."telemetry_key_lookup" ALTER COLUMN "signals" SET DEFAULT '["logs","traces","metrics"]'::jsonb;--> statement-breakpoint
ALTER TABLE "app"."telemetry_ingestion_keys" ALTER COLUMN "signals" SET DEFAULT '["logs","traces","metrics"]'::jsonb;--> statement-breakpoint
ALTER TABLE "app"."dashboards" ADD CONSTRAINT "dashboards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."dashboards" ADD CONSTRAINT "dashboards_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dashboards_slug" ON "app"."dashboards" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboards_public_token" ON "app"."dashboards" USING btree ("public_token");