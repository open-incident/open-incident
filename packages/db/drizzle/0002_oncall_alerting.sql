CREATE TYPE "app"."alert_status" AS ENUM('firing', 'resolved');--> statement-breakpoint
CREATE TYPE "app"."alert_urgency" AS ENUM('high', 'low');--> statement-breakpoint
CREATE TYPE "app"."escalation_status" AS ENUM('pending', 'acked', 'resolved', 'exhausted', 'cancelled');--> statement-breakpoint
CREATE TYPE "app"."notification_method_kind" AS ENUM('email', 'sms', 'voice', 'webpush');--> statement-breakpoint
CREATE TYPE "app"."notification_status" AS ENUM('queued', 'sent', 'delivered', 'failed', 'handled');--> statement-breakpoint
CREATE TYPE "app"."schedule_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "app"."alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"alert_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_kind" "app"."actor_kind" DEFAULT 'system' NOT NULL,
	"actor_member_id" uuid,
	"actor_name" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."alert_priorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"urgency" "app"."alert_urgency" DEFAULT 'high' NOT NULL,
	"color" text DEFAULT 'var(--ink-3)' NOT NULL,
	"rank" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."alert_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"test_mode" boolean DEFAULT false NOT NULL,
	"filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"escalation_mode" text DEFAULT 'dynamic' NOT NULL,
	"escalation_path_id" uuid,
	"urgency_override" "app"."alert_urgency",
	"priority_id" uuid,
	"incident_mode" text DEFAULT 'conditional' NOT NULL,
	"incident_type_id" uuid,
	"defer_minutes" integer DEFAULT 0 NOT NULL,
	"resolve_closes_escalation" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"alert_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."alert_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text NOT NULL,
	"mappings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_alert_at" timestamp with time zone,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"route_id" uuid,
	"dedup_key" text NOT NULL,
	"status" "app"."alert_status" DEFAULT 'firing' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"payload" jsonb NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority_id" uuid,
	"urgency" "app"."alert_urgency",
	"group_id" uuid,
	"group_count" integer DEFAULT 1 NOT NULL,
	"incident_id" uuid,
	"escalation_id" uuid,
	"external_url" text,
	"test_mode" boolean DEFAULT false NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"acked_at" timestamp with time zone,
	"acked_by_member_id" uuid,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."cover_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"rotation_id" uuid,
	"requester_member_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"accepted_by_member_id" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."escalation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"escalation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."escalation_path_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"path_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by_member_id" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."escalation_paths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"current_version_id" uuid,
	"draft_graph" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"path_id" uuid NOT NULL,
	"path_version_id" uuid NOT NULL,
	"alert_id" uuid,
	"incident_id" uuid,
	"status" "app"."escalation_status" DEFAULT 'pending' NOT NULL,
	"urgency" "app"."alert_urgency" DEFAULT 'high' NOT NULL,
	"priority_rank" integer,
	"current_node_id" text,
	"node_entered_at" timestamp with time zone,
	"attempt" integer DEFAULT 1 NOT NULL,
	"retry_loops" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"acked_member_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_tick_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"acked_by_member_id" uuid,
	"acked_at" timestamp with time zone,
	"acked_channel" text,
	"triggered_by_kind" "app"."actor_kind" DEFAULT 'system' NOT NULL,
	"triggered_by_member_id" uuid,
	"triggered_by_name" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid,
	"method_kind" "app"."notification_method_kind" NOT NULL,
	"target" text NOT NULL,
	"kind" text NOT NULL,
	"urgency" "app"."alert_urgency",
	"escalation_id" uuid,
	"alert_id" uuid,
	"status" "app"."notification_status" DEFAULT 'queued' NOT NULL,
	"provider_ref" text,
	"error" text,
	"ack_token" text,
	"message" jsonb DEFAULT '{"subject":"","text":""}'::jsonb NOT NULL,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"handled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."notification_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "app"."notification_method_kind" NOT NULL,
	"value" text NOT NULL,
	"label" text,
	"verified_at" timestamp with time zone,
	"verify_code_hash" text,
	"verify_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."notification_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"urgency" "app"."alert_urgency" NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."rotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"name" text NOT NULL,
	"interval" text DEFAULT 'weekly' NOT NULL,
	"handover_day" integer DEFAULT 1 NOT NULL,
	"active_start" text,
	"active_end" text,
	"member_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."schedule_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"rotation_id" uuid,
	"member_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT 'override' NOT NULL,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"handover_time" text DEFAULT '09:00' NOT NULL,
	"status" "app"."schedule_status" DEFAULT 'draft' NOT NULL,
	"ical_token" text NOT NULL,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."working_hours_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"days" jsonb DEFAULT '[1,2,3,4,5]'::jsonb NOT NULL,
	"start_time" text DEFAULT '09:00' NOT NULL,
	"end_time" text DEFAULT '18:00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."members" ADD COLUMN "shift_reminders" jsonb DEFAULT '{"beforeStart":true,"atEnd":false}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."alert_events" ADD CONSTRAINT "alert_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alert_events" ADD CONSTRAINT "alert_events_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "app"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alert_events" ADD CONSTRAINT "alert_events_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alert_priorities" ADD CONSTRAINT "alert_priorities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alert_routes" ADD CONSTRAINT "alert_routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alert_routes" ADD CONSTRAINT "alert_routes_escalation_path_id_escalation_paths_id_fk" FOREIGN KEY ("escalation_path_id") REFERENCES "app"."escalation_paths"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alert_routes" ADD CONSTRAINT "alert_routes_priority_id_alert_priorities_id_fk" FOREIGN KEY ("priority_id") REFERENCES "app"."alert_priorities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alert_routes" ADD CONSTRAINT "alert_routes_incident_type_id_incident_types_id_fk" FOREIGN KEY ("incident_type_id") REFERENCES "app"."incident_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alert_sources" ADD CONSTRAINT "alert_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alert_sources" ADD CONSTRAINT "alert_sources_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alerts" ADD CONSTRAINT "alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alerts" ADD CONSTRAINT "alerts_source_id_alert_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "app"."alert_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alerts" ADD CONSTRAINT "alerts_route_id_alert_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "app"."alert_routes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alerts" ADD CONSTRAINT "alerts_priority_id_alert_priorities_id_fk" FOREIGN KEY ("priority_id") REFERENCES "app"."alert_priorities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alerts" ADD CONSTRAINT "alerts_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alerts" ADD CONSTRAINT "alerts_acked_by_member_id_members_id_fk" FOREIGN KEY ("acked_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cover_requests" ADD CONSTRAINT "cover_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cover_requests" ADD CONSTRAINT "cover_requests_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "app"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cover_requests" ADD CONSTRAINT "cover_requests_rotation_id_rotations_id_fk" FOREIGN KEY ("rotation_id") REFERENCES "app"."rotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cover_requests" ADD CONSTRAINT "cover_requests_requester_member_id_members_id_fk" FOREIGN KEY ("requester_member_id") REFERENCES "app"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cover_requests" ADD CONSTRAINT "cover_requests_accepted_by_member_id_members_id_fk" FOREIGN KEY ("accepted_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."escalation_events" ADD CONSTRAINT "escalation_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."escalation_events" ADD CONSTRAINT "escalation_events_escalation_id_escalations_id_fk" FOREIGN KEY ("escalation_id") REFERENCES "app"."escalations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."escalation_path_versions" ADD CONSTRAINT "escalation_path_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."escalation_path_versions" ADD CONSTRAINT "escalation_path_versions_path_id_escalation_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "app"."escalation_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."escalation_path_versions" ADD CONSTRAINT "escalation_path_versions_published_by_member_id_members_id_fk" FOREIGN KEY ("published_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."escalation_paths" ADD CONSTRAINT "escalation_paths_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."escalations" ADD CONSTRAINT "escalations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."escalations" ADD CONSTRAINT "escalations_path_id_escalation_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "app"."escalation_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."escalations" ADD CONSTRAINT "escalations_path_version_id_escalation_path_versions_id_fk" FOREIGN KEY ("path_version_id") REFERENCES "app"."escalation_path_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."escalations" ADD CONSTRAINT "escalations_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "app"."alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."escalations" ADD CONSTRAINT "escalations_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."escalations" ADD CONSTRAINT "escalations_acked_by_member_id_members_id_fk" FOREIGN KEY ("acked_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."escalations" ADD CONSTRAINT "escalations_triggered_by_member_id_members_id_fk" FOREIGN KEY ("triggered_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_escalation_id_escalations_id_fk" FOREIGN KEY ("escalation_id") REFERENCES "app"."escalations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "app"."alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_methods" ADD CONSTRAINT "notification_methods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_methods" ADD CONSTRAINT "notification_methods_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "app"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_rules" ADD CONSTRAINT "notification_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_rules" ADD CONSTRAINT "notification_rules_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "app"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rotations" ADD CONSTRAINT "rotations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rotations" ADD CONSTRAINT "rotations_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "app"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."schedule_overrides" ADD CONSTRAINT "schedule_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."schedule_overrides" ADD CONSTRAINT "schedule_overrides_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "app"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."schedule_overrides" ADD CONSTRAINT "schedule_overrides_rotation_id_rotations_id_fk" FOREIGN KEY ("rotation_id") REFERENCES "app"."rotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."schedule_overrides" ADD CONSTRAINT "schedule_overrides_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "app"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."schedule_overrides" ADD CONSTRAINT "schedule_overrides_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."schedules" ADD CONSTRAINT "schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."schedules" ADD CONSTRAINT "schedules_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."working_hours_sets" ADD CONSTRAINT "working_hours_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_events_alert" ON "app"."alert_events" USING btree ("alert_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_priorities_tenant_name" ON "app"."alert_priorities" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_routes_tenant_name" ON "app"."alert_routes" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_sources_tenant_name" ON "app"."alert_sources" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "alerts_tenant_status" ON "app"."alerts" USING btree ("tenant_id","status","last_at");--> statement-breakpoint
CREATE INDEX "alerts_source_dedup" ON "app"."alerts" USING btree ("source_id","dedup_key");--> statement-breakpoint
CREATE INDEX "alerts_incident" ON "app"."alerts" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "cover_requests_schedule" ON "app"."cover_requests" USING btree ("schedule_id","status");--> statement-breakpoint
CREATE INDEX "escalation_events_escalation" ON "app"."escalation_events" USING btree ("escalation_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "escalation_path_versions_path_version" ON "app"."escalation_path_versions" USING btree ("path_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "escalation_paths_tenant_name" ON "app"."escalation_paths" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "escalations_tenant_status_tick" ON "app"."escalations" USING btree ("tenant_id","status","next_tick_at");--> statement-breakpoint
CREATE INDEX "escalations_alert" ON "app"."escalations" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "escalations_incident" ON "app"."escalations" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_member" ON "app"."notification_deliveries" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_escalation" ON "app"."notification_deliveries" USING btree ("escalation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_ack_token" ON "app"."notification_deliveries" USING btree ("ack_token");--> statement-breakpoint
CREATE INDEX "notification_methods_member" ON "app"."notification_methods" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_rules_member_urgency" ON "app"."notification_rules" USING btree ("member_id","urgency");--> statement-breakpoint
CREATE INDEX "rotations_schedule" ON "app"."rotations" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "schedule_overrides_schedule" ON "app"."schedule_overrides" USING btree ("schedule_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "schedules_tenant_name" ON "app"."schedules" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "schedules_ical_token" ON "app"."schedules" USING btree ("ical_token");--> statement-breakpoint
CREATE UNIQUE INDEX "working_hours_sets_tenant_name" ON "app"."working_hours_sets" USING btree ("tenant_id","name");