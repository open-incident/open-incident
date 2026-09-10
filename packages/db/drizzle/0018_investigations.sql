CREATE TABLE "app"."investigations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger" text DEFAULT 'declaration' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"pending_trigger" text,
	"runs" integer DEFAULT 0 NOT NULL,
	"triage" jsonb,
	"summary" jsonb,
	"hypotheses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blast_radius" text,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"provider" text,
	"chat_ref" jsonb,
	"grade" text,
	"grade_note" text,
	"graded_by_member_id" uuid,
	"graded_at" timestamp with time zone,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investigations_incident_id_unique" UNIQUE("incident_id")
);
--> statement-breakpoint
ALTER TABLE "app"."investigations" ADD CONSTRAINT "investigations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."investigations" ADD CONSTRAINT "investigations_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."investigations" ADD CONSTRAINT "investigations_graded_by_member_id_members_id_fk" FOREIGN KEY ("graded_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investigations_tenant_status" ON "app"."investigations" USING btree ("tenant_id","status");