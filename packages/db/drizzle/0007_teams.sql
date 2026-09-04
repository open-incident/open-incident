ALTER TYPE "app"."notification_method_kind" ADD VALUE 'teams';--> statement-breakpoint
ALTER TABLE "app"."incident_channels" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;