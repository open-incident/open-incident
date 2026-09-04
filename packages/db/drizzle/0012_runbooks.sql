CREATE TABLE "app"."runbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_entry_id" uuid,
	"title" text NOT NULL,
	"source_url" text,
	"content" text DEFAULT '' NOT NULL,
	"content_hash" text,
	"fetched_at" timestamp with time zone,
	"fetch_error" text,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."runbooks" ADD CONSTRAINT "runbooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."runbooks" ADD CONSTRAINT "runbooks_service_entry_id_catalog_entries_id_fk" FOREIGN KEY ("service_entry_id") REFERENCES "app"."catalog_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."runbooks" ADD CONSTRAINT "runbooks_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runbooks_tenant_service" ON "app"."runbooks" USING btree ("tenant_id","service_entry_id");