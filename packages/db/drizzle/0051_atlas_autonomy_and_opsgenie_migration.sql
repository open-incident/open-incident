CREATE TABLE "app"."action_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"executor" text NOT NULL,
	"reversible" boolean DEFAULT true NOT NULL,
	"min_level" integer DEFAULT 3 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."atlas_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"investigation_id" uuid,
	"incident_id" uuid,
	"service_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"action_key" text,
	"title" text NOT NULL,
	"detail" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decided_by" text DEFAULT 'atlas' NOT NULL,
	"decided_by_member_id" uuid,
	"level" integer,
	"autonomous" boolean DEFAULT false NOT NULL,
	"approval_state" text DEFAULT 'none' NOT NULL,
	"approval_requested_at" timestamp with time zone,
	"approved_by_member_id" uuid,
	"executed_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"reversible" boolean DEFAULT false NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by_member_id" uuid,
	"redone_at" timestamp with time zone,
	"cost_eur" double precision DEFAULT 0 NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."atlas_notify_prefs" (
	"tenant_id" uuid NOT NULL,
	"member_id" uuid PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'summary' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."atlas_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"kill_switch" boolean DEFAULT false NOT NULL,
	"kill_switch_at" timestamp with time zone,
	"kill_switch_by_member_id" uuid,
	"guardrails" jsonb DEFAULT '{"sev1":true,"securityAndPrivate":true,"firstUseOnService":true,"changeFreeze":true,"publicStatusPage":true,"catalogOnly":true}'::jsonb NOT NULL,
	"budget_month_eur" double precision,
	"cap_per_run_eur" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."autonomy_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"from_level" integer NOT NULL,
	"to_level" integer NOT NULL,
	"cause" text NOT NULL,
	"by_member_id" uuid,
	"investigation_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."backtests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"window_days" integer DEFAULT 90 NOT NULL,
	"incidents" integer DEFAULT 0 NOT NULL,
	"grades" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_eur" double precision DEFAULT 0 NOT NULL,
	"error" text,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."service_autonomy" (
	"tenant_id" uuid NOT NULL,
	"service_id" uuid PRIMARY KEY NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"cap" integer,
	"incidents_seen" integer DEFAULT 0 NOT NULL,
	"graded_runs" integer DEFAULT 0 NOT NULL,
	"right_pct" double precision,
	"backtest_pct" double precision,
	"proposals_ok" integer DEFAULT 0 NOT NULL,
	"l3_fixes_ok" integer DEFAULT 0 NOT NULL,
	"last_miss_at" timestamp with time zone,
	"changed_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."migration_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"type" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"oi_id" uuid,
	"oi_table" text,
	"status" text DEFAULT 'read' NOT NULL,
	"activity" text,
	"conflict" jsonb,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."migration_people_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"external_user_id" text NOT NULL,
	"external_email" text,
	"external_name" text,
	"blocked" boolean DEFAULT false NOT NULL,
	"member_id" uuid,
	"method" text,
	"conflict" text,
	"future_slots" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."migration_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text DEFAULT 'opsgenie' NOT NULL,
	"region" text DEFAULT 'eu' NOT NULL,
	"encrypted_key" text,
	"key_checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"step" text DEFAULT 'connect' NOT NULL,
	"steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"progress_label" text,
	"shadow_token_hash" text,
	"archive_cursor" jsonb,
	"error" text,
	"started_by_member_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."migration_team_switch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"team_external_id" text NOT NULL,
	"team_id" uuid,
	"state" text DEFAULT 'pending' NOT NULL,
	"switched_at" timestamp with time zone,
	"switched_by_member_id" uuid,
	"rolled_back_at" timestamp with time zone,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."shadow_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"alert_external_id" text NOT NULL,
	"alert_title" text,
	"team_external_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opsgenie_paged" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"oi_would_page" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agrees" boolean DEFAULT true NOT NULL,
	"resolution" text,
	"resolved_by_member_id" uuid,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."investigations" ADD COLUMN "level_at_start" integer;--> statement-breakpoint
ALTER TABLE "app"."investigations" ADD COLUMN "resolved_alone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."investigations" ADD COLUMN "cost_eur" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."investigations" ADD COLUMN "tokens_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."investigations" ADD COLUMN "review_state" text;--> statement-breakpoint
ALTER TABLE "app"."action_catalog" ADD CONSTRAINT "action_catalog_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."atlas_actions" ADD CONSTRAINT "atlas_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."atlas_actions" ADD CONSTRAINT "atlas_actions_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "app"."investigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."atlas_actions" ADD CONSTRAINT "atlas_actions_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."atlas_actions" ADD CONSTRAINT "atlas_actions_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."atlas_actions" ADD CONSTRAINT "atlas_actions_decided_by_member_id_members_id_fk" FOREIGN KEY ("decided_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."atlas_actions" ADD CONSTRAINT "atlas_actions_approved_by_member_id_members_id_fk" FOREIGN KEY ("approved_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."atlas_actions" ADD CONSTRAINT "atlas_actions_undone_by_member_id_members_id_fk" FOREIGN KEY ("undone_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."atlas_notify_prefs" ADD CONSTRAINT "atlas_notify_prefs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."atlas_notify_prefs" ADD CONSTRAINT "atlas_notify_prefs_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "app"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."atlas_settings" ADD CONSTRAINT "atlas_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."atlas_settings" ADD CONSTRAINT "atlas_settings_kill_switch_by_member_id_members_id_fk" FOREIGN KEY ("kill_switch_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."autonomy_events" ADD CONSTRAINT "autonomy_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."autonomy_events" ADD CONSTRAINT "autonomy_events_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."autonomy_events" ADD CONSTRAINT "autonomy_events_by_member_id_members_id_fk" FOREIGN KEY ("by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."autonomy_events" ADD CONSTRAINT "autonomy_events_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "app"."investigations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."backtests" ADD CONSTRAINT "backtests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."backtests" ADD CONSTRAINT "backtests_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."service_autonomy" ADD CONSTRAINT "service_autonomy_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."service_autonomy" ADD CONSTRAINT "service_autonomy_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_items" ADD CONSTRAINT "migration_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_items" ADD CONSTRAINT "migration_items_run_id_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."migration_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_people_map" ADD CONSTRAINT "migration_people_map_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_people_map" ADD CONSTRAINT "migration_people_map_run_id_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."migration_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_people_map" ADD CONSTRAINT "migration_people_map_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_runs" ADD CONSTRAINT "migration_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_runs" ADD CONSTRAINT "migration_runs_started_by_member_id_members_id_fk" FOREIGN KEY ("started_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_team_switch" ADD CONSTRAINT "migration_team_switch_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_team_switch" ADD CONSTRAINT "migration_team_switch_run_id_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."migration_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_team_switch" ADD CONSTRAINT "migration_team_switch_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "app"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_team_switch" ADD CONSTRAINT "migration_team_switch_switched_by_member_id_members_id_fk" FOREIGN KEY ("switched_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shadow_decisions" ADD CONSTRAINT "shadow_decisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shadow_decisions" ADD CONSTRAINT "shadow_decisions_run_id_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."migration_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."shadow_decisions" ADD CONSTRAINT "shadow_decisions_resolved_by_member_id_members_id_fk" FOREIGN KEY ("resolved_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_catalog_key" ON "app"."action_catalog" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "atlas_actions_investigation" ON "app"."atlas_actions" USING btree ("tenant_id","investigation_id","at");--> statement-breakpoint
CREATE INDEX "atlas_actions_incident" ON "app"."atlas_actions" USING btree ("tenant_id","incident_id","at");--> statement-breakpoint
CREATE INDEX "atlas_notify_prefs_tenant" ON "app"."atlas_notify_prefs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "autonomy_events_service" ON "app"."autonomy_events" USING btree ("tenant_id","service_id","created_at");--> statement-breakpoint
CREATE INDEX "backtests_tenant" ON "app"."backtests" USING btree ("tenant_id","run_at");--> statement-breakpoint
CREATE INDEX "service_autonomy_tenant" ON "app"."service_autonomy" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_items_external" ON "app"."migration_items" USING btree ("run_id","type","external_id");--> statement-breakpoint
CREATE INDEX "migration_items_tenant" ON "app"."migration_items" USING btree ("tenant_id","run_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_people_map_user" ON "app"."migration_people_map" USING btree ("run_id","external_user_id");--> statement-breakpoint
CREATE INDEX "migration_runs_tenant" ON "app"."migration_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_team_switch_team" ON "app"."migration_team_switch" USING btree ("run_id","team_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shadow_decisions_alert" ON "app"."shadow_decisions" USING btree ("run_id","alert_external_id");--> statement-breakpoint
CREATE INDEX "shadow_decisions_tenant" ON "app"."shadow_decisions" USING btree ("tenant_id","run_id","received_at");