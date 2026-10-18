CREATE TABLE "app"."chat_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"direction" text DEFAULT 'out' NOT NULL,
	"kind" text NOT NULL,
	"target" text,
	"detail" text,
	"status" text DEFAULT 'delivered' NOT NULL,
	"error" text,
	"incident_id" uuid,
	"member_id" uuid,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."service_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_service_id" uuid NOT NULL,
	"to_service_id" uuid NOT NULL,
	"state" text DEFAULT 'declared' NOT NULL,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."alert_sources" ADD COLUMN "incident_from_rank" integer;--> statement-breakpoint
ALTER TABLE "app"."alert_sources" ADD COLUMN "test_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."api_keys" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."api_keys" ADD COLUMN "resources" text[];--> statement-breakpoint
ALTER TABLE "app"."rotations" ADD COLUMN "previous_orders" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."services" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."atlas_notify_prefs" ADD COLUMN "last_summary_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."atlas_settings" ADD COLUMN "executor_nonce" text;--> statement-breakpoint
ALTER TABLE "app"."backtests" ADD COLUMN "stats" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."service_autonomy" ADD COLUMN "right_since_drop" integer;--> statement-breakpoint
ALTER TABLE "app"."migration_runs" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."migration_runs" ADD COLUMN "shadow_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "app"."migration_runs" ADD COLUMN "shadow_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."migration_runs" ADD COLUMN "inventory_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."migration_runs" ADD COLUMN "confirmations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."migration_runs" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."shadow_decisions" ADD COLUMN "cause" text;--> statement-breakpoint
ALTER TABLE "app"."shadow_decisions" ADD COLUMN "detail" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."chat_events" ADD CONSTRAINT "chat_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chat_events" ADD CONSTRAINT "chat_events_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chat_events" ADD CONSTRAINT "chat_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."service_links" ADD CONSTRAINT "service_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."service_links" ADD CONSTRAINT "service_links_from_service_id_services_id_fk" FOREIGN KEY ("from_service_id") REFERENCES "app"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."service_links" ADD CONSTRAINT "service_links_to_service_id_services_id_fk" FOREIGN KEY ("to_service_id") REFERENCES "app"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."service_links" ADD CONSTRAINT "service_links_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_events_tenant_time" ON "app"."chat_events" USING btree ("tenant_id","provider","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_links_pair" ON "app"."service_links" USING btree ("tenant_id","from_service_id","to_service_id");--> statement-breakpoint
CREATE INDEX "service_links_to" ON "app"."service_links" USING btree ("tenant_id","to_service_id");