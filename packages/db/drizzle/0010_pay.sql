CREATE TABLE "app"."pay_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"rules_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."pay_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"standby_cents" integer DEFAULT 0 NOT NULL,
	"night_cents" integer DEFAULT 0 NOT NULL,
	"weekend_cents" integer DEFAULT 0 NOT NULL,
	"holiday_cents" integer DEFAULT 0 NOT NULL,
	"night_start" text DEFAULT '22:00' NOT NULL,
	"night_end" text DEFAULT '07:00' NOT NULL,
	"holidays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."pay_reports" ADD CONSTRAINT "pay_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pay_reports" ADD CONSTRAINT "pay_reports_published_by_member_id_members_id_fk" FOREIGN KEY ("published_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pay_rules" ADD CONSTRAINT "pay_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pay_reports_tenant_period" ON "app"."pay_reports" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_rules_tenant" ON "app"."pay_rules" USING btree ("tenant_id");