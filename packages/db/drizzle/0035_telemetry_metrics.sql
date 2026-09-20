ALTER TABLE "app"."telemetry_settings" ALTER COLUMN "enabled_signals" SET DEFAULT '["logs","traces","metrics"]'::jsonb;--> statement-breakpoint
ALTER TABLE "app"."telemetry_settings" ADD COLUMN "retention_metrics_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."telemetry_settings" ADD COLUMN "cardinality_budget" integer;