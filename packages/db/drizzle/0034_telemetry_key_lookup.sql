CREATE TABLE "directory"."telemetry_key_lookup" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key_id" uuid NOT NULL,
	"signals" jsonb DEFAULT '["logs","traces"]'::jsonb NOT NULL,
	"pinned_service_name" text,
	"revoked" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "directory"."telemetry_key_lookup" ADD CONSTRAINT "telemetry_key_lookup_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;