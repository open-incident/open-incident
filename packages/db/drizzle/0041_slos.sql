CREATE TABLE "app"."slos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"service_id" uuid,
	"good_query" text NOT NULL,
	"total_query" text NOT NULL,
	"objective" double precision DEFAULT 99.9 NOT NULL,
	"window_kind" text DEFAULT 'rolling' NOT NULL,
	"window_days" integer DEFAULT 28 NOT NULL,
	"burn_alerts" boolean DEFAULT true NOT NULL,
	"action" jsonb NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"last_evaluated_at" timestamp with time zone,
	"last_sli" double precision,
	"last_budget_left" double precision,
	"last_fast_burn" double precision,
	"last_slow_burn" double precision,
	"last_detail" text,
	"burn_state" text DEFAULT 'ok' NOT NULL,
	"burn_since" timestamp with time zone,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."slos" ADD CONSTRAINT "slos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."slos" ADD CONSTRAINT "slos_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."slos" ADD CONSTRAINT "slos_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slos_tenant_name" ON "app"."slos" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "slos_tenant_service" ON "app"."slos" USING btree ("tenant_id","service_id");