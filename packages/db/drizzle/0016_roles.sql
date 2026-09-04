CREATE TABLE "app"."custom_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base" "app"."member_role" DEFAULT 'responder' NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."members" ADD COLUMN "custom_role_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."custom_roles" ADD CONSTRAINT "custom_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_roles_tenant_key" ON "app"."custom_roles" USING btree ("tenant_id","key");--> statement-breakpoint
ALTER TABLE "app"."members" ADD CONSTRAINT "members_custom_role_id_custom_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "app"."custom_roles"("id") ON DELETE set null ON UPDATE no action;