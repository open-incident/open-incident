CREATE TABLE "app"."monitor_secrets" (
	"tenant_id" uuid NOT NULL,
	"monitor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitor_secrets_monitor_id_name_pk" PRIMARY KEY("monitor_id","name")
);
--> statement-breakpoint
ALTER TABLE "app"."monitor_checks" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "app"."monitor_secrets" ADD CONSTRAINT "monitor_secrets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."monitor_secrets" ADD CONSTRAINT "monitor_secrets_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "app"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitor_secrets_tenant" ON "app"."monitor_secrets" USING btree ("tenant_id");