ALTER TABLE "directory"."rum_app_lookup" ADD COLUMN "replay_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "directory"."rum_app_lookup" ADD COLUMN "replay_sample_rate" double precision DEFAULT 0.1 NOT NULL;--> statement-breakpoint
ALTER TABLE "directory"."rum_app_lookup" ADD COLUMN "replay_unmask" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."rum_applications" ADD COLUMN "replay_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."rum_applications" ADD COLUMN "replay_sample_rate" double precision DEFAULT 0.1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."rum_applications" ADD COLUMN "replay_unmask" jsonb DEFAULT '[]'::jsonb NOT NULL;