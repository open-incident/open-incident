CREATE TABLE "app"."heartbeats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"service_entry_id" uuid,
	"interval_seconds" integer DEFAULT 3600 NOT NULL,
	"grace_seconds" integer DEFAULT 300 NOT NULL,
	"encrypted_token" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"last_ping_at" timestamp with time zone,
	"last_missed_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."alert_sources" ADD COLUMN "encrypted_secret" text;--> statement-breakpoint
ALTER TABLE "app"."alert_sources" ADD COLUMN "managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."heartbeats" ADD CONSTRAINT "heartbeats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."heartbeats" ADD CONSTRAINT "heartbeats_service_entry_id_catalog_entries_id_fk" FOREIGN KEY ("service_entry_id") REFERENCES "app"."catalog_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "heartbeats_tenant_active" ON "app"."heartbeats" USING btree ("tenant_id","active");