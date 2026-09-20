ALTER TABLE "app"."telemetry_usage" ALTER COLUMN "bytes" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "app"."telemetry_usage" ADD COLUMN "dropped" integer DEFAULT 0 NOT NULL;