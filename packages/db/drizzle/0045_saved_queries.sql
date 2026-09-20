CREATE TABLE "app"."saved_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"signal" text NOT NULL,
	"query" text NOT NULL,
	"service" text,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."saved_queries" ADD CONSTRAINT "saved_queries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."saved_queries" ADD CONSTRAINT "saved_queries_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_queries_tenant_name" ON "app"."saved_queries" USING btree ("tenant_id","signal","name");--> statement-breakpoint
CREATE INDEX "saved_queries_tenant_signal" ON "app"."saved_queries" USING btree ("tenant_id","signal");