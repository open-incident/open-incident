CREATE TABLE "app"."ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"actor_kind" "app"."actor_kind" DEFAULT 'member' NOT NULL,
	"actor_member_id" uuid,
	"actor_name" text,
	"incident_id" uuid,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '{"catalog":true,"incidents":true,"changeEvents":true,"docs":false}'::jsonb NOT NULL,
	"private_opt_in" boolean DEFAULT false NOT NULL,
	"provider" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."atlas_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"ref_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"embedding" jsonb,
	"model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text DEFAULT 'deploy' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"service_entry_id" uuid,
	"environment" text,
	"actor_name" text,
	"external_ref" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD COLUMN "ai_summary_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."ai_calls" ADD CONSTRAINT "ai_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_calls" ADD CONSTRAINT "ai_calls_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_calls" ADD CONSTRAINT "ai_calls_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_settings" ADD CONSTRAINT "ai_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."atlas_documents" ADD CONSTRAINT "atlas_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."change_events" ADD CONSTRAINT "change_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."change_events" ADD CONSTRAINT "change_events_service_entry_id_catalog_entries_id_fk" FOREIGN KEY ("service_entry_id") REFERENCES "app"."catalog_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_tenant_created" ON "app"."ai_calls" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_settings_tenant" ON "app"."ai_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "atlas_documents_source_ref" ON "app"."atlas_documents" USING btree ("tenant_id","source","ref_id");--> statement-breakpoint
CREATE INDEX "change_events_tenant_occurred" ON "app"."change_events" USING btree ("tenant_id","occurred_at");