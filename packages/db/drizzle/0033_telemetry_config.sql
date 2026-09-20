CREATE TABLE "app"."telemetry_ingestion_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"label" text NOT NULL,
	"signals" jsonb DEFAULT '["logs","traces"]'::jsonb NOT NULL,
	"pinned_service_name" text,
	"rate_limit_rpm" integer,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."telemetry_rejections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key_id" uuid,
	"signal" text NOT NULL,
	"reason" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."telemetry_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"enabled_signals" jsonb DEFAULT '["logs","traces"]'::jsonb NOT NULL,
	"retention_logs_days" integer DEFAULT 15 NOT NULL,
	"retention_traces_days" integer DEFAULT 15 NOT NULL,
	"scrub_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"daily_soft_cap_gb" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."telemetry_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"day" text NOT NULL,
	"signal" text NOT NULL,
	"rows" integer DEFAULT 0 NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."services" ADD COLUMN "telemetry_first_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."services" ADD COLUMN "telemetry_last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."services" ADD COLUMN "tech_stack" text;--> statement-breakpoint
ALTER TABLE "app"."services" ADD COLUMN "retention_override_days" integer;--> statement-breakpoint
ALTER TABLE "app"."telemetry_ingestion_keys" ADD CONSTRAINT "telemetry_ingestion_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."telemetry_rejections" ADD CONSTRAINT "telemetry_rejections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."telemetry_rejections" ADD CONSTRAINT "telemetry_rejections_key_id_telemetry_ingestion_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "app"."telemetry_ingestion_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."telemetry_settings" ADD CONSTRAINT "telemetry_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."telemetry_usage" ADD CONSTRAINT "telemetry_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telemetry_keys_hash" ON "app"."telemetry_ingestion_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "telemetry_keys_tenant" ON "app"."telemetry_ingestion_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "telemetry_rejections_tenant" ON "app"."telemetry_rejections" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telemetry_usage_day" ON "app"."telemetry_usage" USING btree ("tenant_id","day","signal");