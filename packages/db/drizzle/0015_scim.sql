CREATE TABLE "app"."scim_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"default_role" "app"."member_role" DEFAULT 'responder' NOT NULL,
	"send_invites" boolean DEFAULT true NOT NULL,
	"created_by_member_id" uuid,
	"last_seen_at" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."members" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "app"."members" ADD COLUMN "source" text DEFAULT 'ui' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."scim_settings" ADD CONSTRAINT "scim_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."scim_settings" ADD CONSTRAINT "scim_settings_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scim_settings_tenant" ON "app"."scim_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_tenant_external" ON "app"."members" USING btree ("tenant_id","external_id");