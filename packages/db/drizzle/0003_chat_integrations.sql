ALTER TYPE "app"."notification_method_kind" ADD VALUE 'slack';--> statement-breakpoint
CREATE TABLE "app"."chat_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text DEFAULT 'slack' NOT NULL,
	"external_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."incident_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" text DEFAULT 'slack' NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text NOT NULL,
	"header_ts" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."integration_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"external_id" text,
	"external_name" text,
	"encrypted_secrets" text,
	"bot_user_id" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"installed_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."announcements" ADD COLUMN "chat_ref" jsonb;--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD COLUMN "bridge_url" text;--> statement-breakpoint
ALTER TABLE "app"."chat_identities" ADD CONSTRAINT "chat_identities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chat_identities" ADD CONSTRAINT "chat_identities_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "app"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_channels" ADD CONSTRAINT "incident_channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_channels" ADD CONSTRAINT "incident_channels_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."integration_installs" ADD CONSTRAINT "integration_installs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."integration_installs" ADD CONSTRAINT "integration_installs_installed_by_member_id_members_id_fk" FOREIGN KEY ("installed_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_identities_kind_user" ON "app"."chat_identities" USING btree ("tenant_id","kind","external_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_identities_member_kind" ON "app"."chat_identities" USING btree ("member_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_channels_incident_kind" ON "app"."incident_channels" USING btree ("incident_id","kind");--> statement-breakpoint
CREATE INDEX "incident_channels_channel" ON "app"."incident_channels" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_installs_tenant_kind" ON "app"."integration_installs" USING btree ("tenant_id","kind");