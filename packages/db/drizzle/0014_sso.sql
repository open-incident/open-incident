CREATE TABLE "auth"."sso_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" text,
	"provider_id" text NOT NULL,
	"organization_id" text,
	"domain" text NOT NULL,
	"domain_verified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sso_provider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "app"."sso_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"default_role" "app"."member_role" DEFAULT 'responder' NOT NULL,
	"allowed_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enforce" boolean DEFAULT false NOT NULL,
	"jit_provisioning" boolean DEFAULT true NOT NULL,
	"created_by_member_id" uuid,
	"last_sign_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."sso_provider" ADD CONSTRAINT "sso_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sso_connections" ADD CONSTRAINT "sso_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sso_connections" ADD CONSTRAINT "sso_connections_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sso_connections_provider" ON "app"."sso_connections" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "sso_connections_tenant" ON "app"."sso_connections" USING btree ("tenant_id");