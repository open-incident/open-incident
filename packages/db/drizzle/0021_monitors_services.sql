CREATE TYPE "app"."monitor_state" AS ENUM('online', 'degraded', 'offline', 'paused', 'waiting');--> statement-breakpoint
CREATE TABLE "app"."alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"test_mode" boolean DEFAULT false NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."monitor_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"monitor_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" "app"."monitor_state" NOT NULL,
	"latency_ms" integer,
	"detail" text,
	"probe_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."monitor_days" (
	"tenant_id" uuid NOT NULL,
	"monitor_id" uuid NOT NULL,
	"day" text NOT NULL,
	"online_seconds" integer DEFAULT 0 NOT NULL,
	"degraded_seconds" integer DEFAULT 0 NOT NULL,
	"offline_seconds" integer DEFAULT 0 NOT NULL,
	"checks" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitor_days_monitor_id_day_pk" PRIMARY KEY("monitor_id","day")
);
--> statement-breakpoint
CREATE TABLE "app"."monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"target" text DEFAULT '' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"interval_seconds" integer DEFAULT 60 NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"service_id" uuid,
	"state" "app"."monitor_state" DEFAULT 'waiting' NOT NULL,
	"state_since" timestamp with time zone,
	"last_check_at" timestamp with time zone,
	"last_latency_ms" integer,
	"last_detail" text,
	"incoming_token" text,
	"expect_every_seconds" integer,
	"open_alert_id" uuid,
	"paused" boolean DEFAULT false NOT NULL,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."probes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"managed" boolean DEFAULT true NOT NULL,
	"secret_hash" text,
	"last_seen_at" timestamp with time zone,
	"version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text,
	"owner_team_id" uuid,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"seen_in" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."team_members" (
	"tenant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_member_id_pk" PRIMARY KEY("team_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "app"."teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"policy_path_id" uuid,
	"chat_channel" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."alert_rules" ADD CONSTRAINT "alert_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."monitor_checks" ADD CONSTRAINT "monitor_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."monitor_checks" ADD CONSTRAINT "monitor_checks_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "app"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."monitor_checks" ADD CONSTRAINT "monitor_checks_probe_id_probes_id_fk" FOREIGN KEY ("probe_id") REFERENCES "app"."probes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."monitor_days" ADD CONSTRAINT "monitor_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."monitor_days" ADD CONSTRAINT "monitor_days_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "app"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."monitors" ADD CONSTRAINT "monitors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."monitors" ADD CONSTRAINT "monitors_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."monitors" ADD CONSTRAINT "monitors_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."probes" ADD CONSTRAINT "probes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."services" ADD CONSTRAINT "services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."team_members" ADD CONSTRAINT "team_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "app"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."team_members" ADD CONSTRAINT "team_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "app"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."teams" ADD CONSTRAINT "teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."teams" ADD CONSTRAINT "teams_policy_path_id_escalation_paths_id_fk" FOREIGN KEY ("policy_path_id") REFERENCES "app"."escalation_paths"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_rules_tenant_position" ON "app"."alert_rules" USING btree ("tenant_id","position");--> statement-breakpoint
CREATE INDEX "monitor_checks_monitor_at" ON "app"."monitor_checks" USING btree ("monitor_id","at");--> statement-breakpoint
CREATE INDEX "monitor_days_tenant" ON "app"."monitor_days" USING btree ("tenant_id","day");--> statement-breakpoint
CREATE INDEX "monitors_tenant_state" ON "app"."monitors" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "monitors_tenant_service" ON "app"."monitors" USING btree ("tenant_id","service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "monitors_incoming_token" ON "app"."monitors" USING btree ("incoming_token");--> statement-breakpoint
CREATE INDEX "probes_tenant" ON "app"."probes" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_tenant_key" ON "app"."services" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "services_tenant_owner" ON "app"."services" USING btree ("tenant_id","owner_team_id");--> statement-breakpoint
CREATE INDEX "team_members_tenant" ON "app"."team_members" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_tenant_name" ON "app"."teams" USING btree ("tenant_id","name");--> statement-breakpoint
-- Declared here rather than in the schema file: `services` is written before
-- `teams`, so Drizzle cannot name the target while generating it.
ALTER TABLE "app"."services" ADD CONSTRAINT "services_owner_team_id_teams_id_fk"
  FOREIGN KEY ("owner_team_id") REFERENCES "app"."teams"("id") ON DELETE set null;--> statement-breakpoint
-- The alert a monitor has open, so its recovery resolves that very alert.
ALTER TABLE "app"."monitors" ADD CONSTRAINT "monitors_open_alert_id_alerts_id_fk"
  FOREIGN KEY ("open_alert_id") REFERENCES "app"."alerts"("id") ON DELETE set null;
