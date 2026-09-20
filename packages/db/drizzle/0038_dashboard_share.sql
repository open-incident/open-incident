CREATE TABLE "directory"."dashboard_share" (
	"token" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dashboard_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory"."dashboard_share" ADD CONSTRAINT "dashboard_share_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;