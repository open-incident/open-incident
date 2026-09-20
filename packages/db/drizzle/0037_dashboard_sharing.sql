ALTER TABLE "app"."dashboards" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."dashboards" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "app"."dashboards" ADD COLUMN "ip_allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL;