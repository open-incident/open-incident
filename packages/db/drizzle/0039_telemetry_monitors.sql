CREATE TABLE "app"."telemetry_monitor_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"monitor_id" uuid NOT NULL,
	"series_key" text NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'ok' NOT NULL,
	"last_verdict" text DEFAULT 'ok' NOT NULL,
	"consecutive" integer DEFAULT 0 NOT NULL,
	"last_value" double precision,
	"last_detail" text,
	"state_since" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."monitors" ADD COLUMN "telemetry_query" jsonb;--> statement-breakpoint
ALTER TABLE "app"."telemetry_monitor_series" ADD CONSTRAINT "telemetry_monitor_series_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."telemetry_monitor_series" ADD CONSTRAINT "telemetry_monitor_series_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "app"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telemetry_series_once" ON "app"."telemetry_monitor_series" USING btree ("monitor_id","series_key");--> statement-breakpoint
CREATE INDEX "telemetry_series_seen" ON "app"."telemetry_monitor_series" USING btree ("last_seen_at");