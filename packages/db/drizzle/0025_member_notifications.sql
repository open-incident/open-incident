CREATE TYPE "app"."member_notification_kind" AS ENUM('paged', 'incident', 'follow_up', 'mention');--> statement-breakpoint
CREATE TABLE "app"."member_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "app"."member_notification_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"url" text,
	"incident_id" uuid,
	"alert_id" uuid,
	"group_key" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."member_notifications" ADD CONSTRAINT "member_notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."member_notifications" ADD CONSTRAINT "member_notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "app"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."member_notifications" ADD CONSTRAINT "member_notifications_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."member_notifications" ADD CONSTRAINT "member_notifications_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "app"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_notifications_inbox" ON "app"."member_notifications" USING btree ("tenant_id","member_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "member_notifications_group" ON "app"."member_notifications" USING btree ("tenant_id","member_id","group_key");