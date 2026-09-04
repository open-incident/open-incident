CREATE TABLE "app"."qa_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"suite" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"command" text DEFAULT '' NOT NULL,
	"exit_code" integer,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"log" text DEFAULT '' NOT NULL,
	"log_truncated" boolean DEFAULT false NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"triggered_by_member_id" uuid,
	"triggered_by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."qa_runs" ADD CONSTRAINT "qa_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."qa_runs" ADD CONSTRAINT "qa_runs_triggered_by_member_id_members_id_fk" FOREIGN KEY ("triggered_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qa_runs_tenant_queued" ON "app"."qa_runs" USING btree ("tenant_id","created_at");