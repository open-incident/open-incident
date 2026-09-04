CREATE TABLE "directory"."status_snapshots" (
	"page_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"custom_domain" text,
	"snapshot" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."component_impact_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"state" text NOT NULL,
	"from_at" timestamp with time zone NOT NULL,
	"to_at" timestamp with time zone,
	"status_page_incident_id" uuid,
	"maintenance_id" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."status_page_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"name" text NOT NULL,
	"group_name" text,
	"position" integer DEFAULT 0 NOT NULL,
	"service_entry_id" uuid,
	"state" text DEFAULT 'operational' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."status_page_incident_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status_page_incident_id" uuid NOT NULL,
	"status" text NOT NULL,
	"body" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_member_id" uuid,
	"notified_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."status_page_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"incident_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'investigating' NOT NULL,
	"impact" text DEFAULT 'degraded' NOT NULL,
	"component_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."status_page_maintenance_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"maintenance_id" uuid NOT NULL,
	"status" text NOT NULL,
	"body" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."status_page_maintenances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"component_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"auto_transitions" boolean DEFAULT true NOT NULL,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."status_page_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"email" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirm_token" text NOT NULL,
	"unsubscribe_token" text NOT NULL,
	"source" text DEFAULT 'form' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."status_page_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"body" text NOT NULL,
	"approved" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."status_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"custom_domain" text,
	"custom_domain_verified_at" timestamp with time zone,
	"locale" text DEFAULT 'en' NOT NULL,
	"accent_color" text DEFAULT '#0B4A6F' NOT NULL,
	"noindex" boolean DEFAULT true NOT NULL,
	"privacy_url" text,
	"legal_url" text,
	"reply_to" text,
	"min_severity_rank" integer DEFAULT 1 NOT NULL,
	"feed_hits" integer DEFAULT 0 NOT NULL,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory"."status_snapshots" ADD CONSTRAINT "status_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."component_impact_history" ADD CONSTRAINT "component_impact_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."component_impact_history" ADD CONSTRAINT "component_impact_history_component_id_status_page_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "app"."status_page_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_components" ADD CONSTRAINT "status_page_components_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_components" ADD CONSTRAINT "status_page_components_page_id_status_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "app"."status_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_components" ADD CONSTRAINT "status_page_components_service_entry_id_catalog_entries_id_fk" FOREIGN KEY ("service_entry_id") REFERENCES "app"."catalog_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_incident_updates" ADD CONSTRAINT "status_page_incident_updates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_incident_updates" ADD CONSTRAINT "status_page_incident_updates_status_page_incident_id_status_page_incidents_id_fk" FOREIGN KEY ("status_page_incident_id") REFERENCES "app"."status_page_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_incident_updates" ADD CONSTRAINT "status_page_incident_updates_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_incidents" ADD CONSTRAINT "status_page_incidents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_incidents" ADD CONSTRAINT "status_page_incidents_page_id_status_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "app"."status_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_incidents" ADD CONSTRAINT "status_page_incidents_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_maintenance_updates" ADD CONSTRAINT "status_page_maintenance_updates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_maintenance_updates" ADD CONSTRAINT "status_page_maintenance_updates_maintenance_id_status_page_maintenances_id_fk" FOREIGN KEY ("maintenance_id") REFERENCES "app"."status_page_maintenances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_maintenances" ADD CONSTRAINT "status_page_maintenances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_maintenances" ADD CONSTRAINT "status_page_maintenances_page_id_status_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "app"."status_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_maintenances" ADD CONSTRAINT "status_page_maintenances_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_subscribers" ADD CONSTRAINT "status_page_subscribers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_subscribers" ADD CONSTRAINT "status_page_subscribers_page_id_status_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "app"."status_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_templates" ADD CONSTRAINT "status_page_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_page_templates" ADD CONSTRAINT "status_page_templates_page_id_status_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "app"."status_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_pages" ADD CONSTRAINT "status_pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."status_pages" ADD CONSTRAINT "status_pages_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "status_snapshots_slug" ON "directory"."status_snapshots" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "status_snapshots_custom_domain" ON "directory"."status_snapshots" USING btree ("custom_domain");--> statement-breakpoint
CREATE INDEX "component_impact_history_component" ON "app"."component_impact_history" USING btree ("component_id","from_at");--> statement-breakpoint
CREATE INDEX "status_page_components_page" ON "app"."status_page_components" USING btree ("page_id","position");--> statement-breakpoint
CREATE INDEX "status_page_incident_updates_incident" ON "app"."status_page_incident_updates" USING btree ("status_page_incident_id","published_at");--> statement-breakpoint
CREATE INDEX "status_page_incidents_page" ON "app"."status_page_incidents" USING btree ("page_id","started_at");--> statement-breakpoint
CREATE INDEX "status_page_incidents_incident" ON "app"."status_page_incidents" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "status_page_maintenance_updates_m" ON "app"."status_page_maintenance_updates" USING btree ("maintenance_id","published_at");--> statement-breakpoint
CREATE INDEX "status_page_maintenances_page" ON "app"."status_page_maintenances" USING btree ("page_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "status_page_subscribers_page_email" ON "app"."status_page_subscribers" USING btree ("page_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "status_page_subscribers_confirm" ON "app"."status_page_subscribers" USING btree ("confirm_token");--> statement-breakpoint
CREATE UNIQUE INDEX "status_page_subscribers_unsub" ON "app"."status_page_subscribers" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE INDEX "status_page_templates_page" ON "app"."status_page_templates" USING btree ("page_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "status_pages_slug" ON "app"."status_pages" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "status_pages_custom_domain" ON "app"."status_pages" USING btree ("custom_domain");