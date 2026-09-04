CREATE SCHEMA "directory";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."actor_kind" AS ENUM('member', 'system', 'api', 'ai');--> statement-breakpoint
CREATE TYPE "app"."catalog_source" AS ENUM('ui', 'code', 'sync');--> statement-breakpoint
CREATE TYPE "app"."field_type" AS ENUM('text', 'long_text', 'select', 'multi_select', 'number', 'link', 'catalog_entry');--> statement-breakpoint
CREATE TYPE "app"."follow_up_status" AS ENUM('open', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "app"."incident_mode" AS ENUM('live', 'retrospective', 'test');--> statement-breakpoint
CREATE TYPE "app"."incident_phase" AS ENUM('triage', 'active', 'post_incident', 'closed');--> statement-breakpoint
CREATE TYPE "app"."incident_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "app"."mail_status" AS ENUM('queued', 'sent', 'failed', 'handled');--> statement-breakpoint
CREATE TYPE "app"."member_role" AS ENUM('owner', 'admin', 'responder', 'viewer');--> statement-breakpoint
CREATE TYPE "app"."member_status" AS ENUM('active', 'invited', 'disabled');--> statement-breakpoint
CREATE TYPE "app"."participant_kind" AS ENUM('participant', 'observer');--> statement-breakpoint
CREATE TABLE "directory"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"custom_domain" text,
	"status" text DEFAULT 'active' NOT NULL,
	"suspended_reason" text,
	"trial_ends_at" timestamp with time zone,
	"entitlements" jsonb,
	"plan_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_custom_domain_unique" UNIQUE("custom_domain")
);
--> statement-breakpoint
CREATE TABLE "auth"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"title" text NOT NULL,
	"assignee_member_id" uuid,
	"created_by_member_id" uuid,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_member_id" uuid,
	"actor_name" text NOT NULL,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"target" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."catalog_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"external_id" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."catalog_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source" "app"."catalog_source" DEFAULT 'ui' NOT NULL,
	"attributes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."debriefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 45 NOT NULL,
	"attendee_member_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invitation_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debriefs_incident_id_unique" UNIQUE("incident_id")
);
--> statement-breakpoint
CREATE TABLE "app"."follow_up_priorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rank" integer NOT NULL,
	"complete_within_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority_id" uuid,
	"assignee_member_id" uuid,
	"assignee_team_entry_id" uuid,
	"status" "app"."follow_up_status" DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"external_ref" jsonb,
	"labels" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."incident_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_kind" "app"."actor_kind" DEFAULT 'member' NOT NULL,
	"actor_member_id" uuid,
	"actor_name" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."incident_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" "app"."field_type" NOT NULL,
	"description" text,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"catalog_type_id" uuid,
	"incident_type_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."incident_participants" (
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "app"."participant_kind" DEFAULT 'observer' NOT NULL,
	"first_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_participants_incident_id_member_id_pk" PRIMARY KEY("incident_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "app"."incident_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"instructions" text,
	"runbook_url" text,
	"is_lead" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."incident_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rank" integer NOT NULL,
	"update_reminder_minutes" integer,
	"counts_in_mttr" boolean DEFAULT true NOT NULL,
	"public_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."incident_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"private_by_default" boolean DEFAULT false NOT NULL,
	"restricted_to_team_ids" jsonb,
	"post_incident_from_rank" integer,
	"declare_form" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."incident_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"member_id" uuid,
	"status_id" uuid,
	"severity_id" uuid,
	"resolves" boolean DEFAULT false NOT NULL,
	"message" text NOT NULL,
	"next_update_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"mode" "app"."incident_mode" DEFAULT 'live' NOT NULL,
	"visibility" "app"."incident_visibility" DEFAULT 'public' NOT NULL,
	"type_id" uuid NOT NULL,
	"severity_id" uuid,
	"phase" "app"."incident_phase" DEFAULT 'active' NOT NULL,
	"status_id" uuid,
	"service_entry_id" uuid,
	"creator_member_id" uuid,
	"source" text DEFAULT 'web' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"next_update_due_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."mail_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"provider" text DEFAULT 'console' NOT NULL,
	"status" "app"."mail_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"ref" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "app"."member_role" DEFAULT 'responder' NOT NULL,
	"status" "app"."member_status" DEFAULT 'invited' NOT NULL,
	"locale" text,
	"timezone" text,
	"avatar_url" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."post_incident_task_defs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"default_assignee_role" text,
	"due_after_days" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."post_incident_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"def_id" uuid,
	"phase" text NOT NULL,
	"title" text NOT NULL,
	"assignee_member_id" uuid,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"skip_reason" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."post_mortems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_drafted" boolean DEFAULT false NOT NULL,
	"external_url" text,
	"owner_member_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_mortems_incident_id_unique" UNIQUE("incident_id")
);
--> statement-breakpoint
CREATE TABLE "app"."role_assignments" (
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_assignments_incident_id_role_id_pk" PRIMARY KEY("incident_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "app"."severities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rank" integer NOT NULL,
	"post_incident" text DEFAULT 'opt_in' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."workspaces" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'Europe/Paris' NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."actions" ADD CONSTRAINT "actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."actions" ADD CONSTRAINT "actions_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."actions" ADD CONSTRAINT "actions_assignee_member_id_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."actions" ADD CONSTRAINT "actions_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_events" ADD CONSTRAINT "audit_events_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."catalog_entries" ADD CONSTRAINT "catalog_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."catalog_entries" ADD CONSTRAINT "catalog_entries_type_id_catalog_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "app"."catalog_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."catalog_types" ADD CONSTRAINT "catalog_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."debriefs" ADD CONSTRAINT "debriefs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."debriefs" ADD CONSTRAINT "debriefs_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."follow_up_priorities" ADD CONSTRAINT "follow_up_priorities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."follow_ups" ADD CONSTRAINT "follow_ups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."follow_ups" ADD CONSTRAINT "follow_ups_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."follow_ups" ADD CONSTRAINT "follow_ups_priority_id_follow_up_priorities_id_fk" FOREIGN KEY ("priority_id") REFERENCES "app"."follow_up_priorities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."follow_ups" ADD CONSTRAINT "follow_ups_assignee_member_id_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."follow_ups" ADD CONSTRAINT "follow_ups_assignee_team_entry_id_catalog_entries_id_fk" FOREIGN KEY ("assignee_team_entry_id") REFERENCES "app"."catalog_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_events" ADD CONSTRAINT "incident_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_events" ADD CONSTRAINT "incident_events_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_events" ADD CONSTRAINT "incident_events_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_fields" ADD CONSTRAINT "incident_fields_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_fields" ADD CONSTRAINT "incident_fields_catalog_type_id_catalog_types_id_fk" FOREIGN KEY ("catalog_type_id") REFERENCES "app"."catalog_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_fields" ADD CONSTRAINT "incident_fields_incident_type_id_incident_types_id_fk" FOREIGN KEY ("incident_type_id") REFERENCES "app"."incident_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_participants" ADD CONSTRAINT "incident_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_participants" ADD CONSTRAINT "incident_participants_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_participants" ADD CONSTRAINT "incident_participants_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "app"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_roles" ADD CONSTRAINT "incident_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_statuses" ADD CONSTRAINT "incident_statuses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_statuses" ADD CONSTRAINT "incident_statuses_type_id_incident_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "app"."incident_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_types" ADD CONSTRAINT "incident_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_updates" ADD CONSTRAINT "incident_updates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_updates" ADD CONSTRAINT "incident_updates_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_updates" ADD CONSTRAINT "incident_updates_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_updates" ADD CONSTRAINT "incident_updates_status_id_incident_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "app"."incident_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_updates" ADD CONSTRAINT "incident_updates_severity_id_severities_id_fk" FOREIGN KEY ("severity_id") REFERENCES "app"."severities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_type_id_incident_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "app"."incident_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_severity_id_severities_id_fk" FOREIGN KEY ("severity_id") REFERENCES "app"."severities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_status_id_incident_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "app"."incident_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_service_entry_id_catalog_entries_id_fk" FOREIGN KEY ("service_entry_id") REFERENCES "app"."catalog_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incidents" ADD CONSTRAINT "incidents_creator_member_id_members_id_fk" FOREIGN KEY ("creator_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."mail_deliveries" ADD CONSTRAINT "mail_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."members" ADD CONSTRAINT "members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_incident_task_defs" ADD CONSTRAINT "post_incident_task_defs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_incident_tasks" ADD CONSTRAINT "post_incident_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_incident_tasks" ADD CONSTRAINT "post_incident_tasks_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_incident_tasks" ADD CONSTRAINT "post_incident_tasks_def_id_post_incident_task_defs_id_fk" FOREIGN KEY ("def_id") REFERENCES "app"."post_incident_task_defs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_incident_tasks" ADD CONSTRAINT "post_incident_tasks_assignee_member_id_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_mortems" ADD CONSTRAINT "post_mortems_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_mortems" ADD CONSTRAINT "post_mortems_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_mortems" ADD CONSTRAINT "post_mortems_owner_member_id_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."role_assignments" ADD CONSTRAINT "role_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."role_assignments" ADD CONSTRAINT "role_assignments_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."role_assignments" ADD CONSTRAINT "role_assignments_role_id_incident_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "app"."incident_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."role_assignments" ADD CONSTRAINT "role_assignments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "app"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."severities" ADD CONSTRAINT "severities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workspaces" ADD CONSTRAINT "workspaces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_account_id" ON "auth"."account" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "actions_incident" ON "app"."actions" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "audit_events_tenant_time" ON "app"."audit_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_entries_type_name" ON "app"."catalog_entries" USING btree ("type_id","name");--> statement-breakpoint
CREATE INDEX "catalog_entries_tenant" ON "app"."catalog_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_types_tenant_key" ON "app"."catalog_types" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_priorities_tenant_name" ON "app"."follow_up_priorities" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "follow_ups_tenant_status" ON "app"."follow_ups" USING btree ("tenant_id","status","due_at");--> statement-breakpoint
CREATE INDEX "incident_events_incident_time" ON "app"."incident_events" USING btree ("incident_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_fields_tenant_key" ON "app"."incident_fields" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_roles_tenant_name" ON "app"."incident_roles" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_statuses_type_name" ON "app"."incident_statuses" USING btree ("type_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_types_tenant_name" ON "app"."incident_types" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "incident_updates_incident" ON "app"."incident_updates" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_tenant_number" ON "app"."incidents" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "incidents_tenant_phase" ON "app"."incidents" USING btree ("tenant_id","phase","last_activity_at");--> statement-breakpoint
CREATE INDEX "mail_deliveries_tenant_time" ON "app"."mail_deliveries" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "members_tenant_email" ON "app"."members" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "post_incident_task_defs_tenant" ON "app"."post_incident_task_defs" USING btree ("tenant_id","phase","position");--> statement-breakpoint
CREATE INDEX "post_incident_tasks_incident" ON "app"."post_incident_tasks" USING btree ("incident_id","phase","position");--> statement-breakpoint
CREATE UNIQUE INDEX "severities_tenant_name" ON "app"."severities" USING btree ("tenant_id","name");