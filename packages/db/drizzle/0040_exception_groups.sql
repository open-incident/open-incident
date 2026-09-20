CREATE TABLE "app"."exception_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by_member_id" uuid,
	"last_alerted_at" timestamp with time zone,
	"last_alert_kind" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."telemetry_settings" ADD COLUMN "exception_regressions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."telemetry_settings" ADD COLUMN "exception_regression_severity" text DEFAULT 'P3' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."exception_groups" ADD CONSTRAINT "exception_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exception_groups" ADD CONSTRAINT "exception_groups_resolved_by_member_id_members_id_fk" FOREIGN KEY ("resolved_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exception_groups_once" ON "app"."exception_groups" USING btree ("tenant_id","fingerprint");--> statement-breakpoint
CREATE INDEX "exception_groups_status" ON "app"."exception_groups" USING btree ("tenant_id","status");