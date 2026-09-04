CREATE TABLE "directory"."api_key_lookup" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."announcement_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"min_severity_rank" integer,
	"type_id" uuid,
	"template_id" uuid NOT NULL,
	"audience" text DEFAULT 'workspace' NOT NULL,
	"triggered_count" integer DEFAULT 0 NOT NULL,
	"last_incident_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."announcement_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"audience" text DEFAULT 'workspace' NOT NULL,
	"body" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"rule_id" uuid,
	"template_id" uuid,
	"audience" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"last_four" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"created_by_member_id" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"http_status" integer,
	"latency_ms" integer,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"encrypted_secret" text NOT NULL,
	"events" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failing_since" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."workspaces" ADD COLUMN "post_mortem_term" text;--> statement-breakpoint
ALTER TABLE "directory"."api_key_lookup" ADD CONSTRAINT "api_key_lookup_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."announcement_rules" ADD CONSTRAINT "announcement_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."announcement_rules" ADD CONSTRAINT "announcement_rules_type_id_incident_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "app"."incident_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."announcement_rules" ADD CONSTRAINT "announcement_rules_template_id_announcement_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."announcement_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."announcement_templates" ADD CONSTRAINT "announcement_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."announcements" ADD CONSTRAINT "announcements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."announcements" ADD CONSTRAINT "announcements_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."announcements" ADD CONSTRAINT "announcements_rule_id_announcement_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "app"."announcement_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."announcements" ADD CONSTRAINT "announcements_template_id_announcement_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."announcement_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."api_keys" ADD CONSTRAINT "api_keys_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "app"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_rules_tenant" ON "app"."announcement_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_templates_tenant_name" ON "app"."announcement_templates" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "announcements_incident_rule" ON "app"."announcements" USING btree ("incident_id","rule_id");--> statement-breakpoint
CREATE INDEX "announcements_tenant_status" ON "app"."announcements" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash" ON "app"."api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_time" ON "app"."webhook_deliveries" USING btree ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_tenant" ON "app"."webhook_endpoints" USING btree ("tenant_id");