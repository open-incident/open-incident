CREATE TABLE "app"."post_mortem_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"post_mortem_id" uuid NOT NULL,
	"section_key" text,
	"body" text NOT NULL,
	"member_id" uuid,
	"member_name" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."post_mortem_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"post_mortem_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"section_key" text,
	"title" text,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor_member_id" uuid,
	"actor_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."post_mortems" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "app"."post_mortems" ADD COLUMN "review_notes" jsonb;--> statement-breakpoint
ALTER TABLE "app"."post_mortems" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."post_mortems" ADD COLUMN "updated_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."post_mortems" ADD COLUMN "updated_by_name" text;--> statement-breakpoint
ALTER TABLE "app"."workspaces" ADD COLUMN "post_mortem_template" jsonb;--> statement-breakpoint
ALTER TABLE "app"."post_mortem_comments" ADD CONSTRAINT "post_mortem_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_mortem_comments" ADD CONSTRAINT "post_mortem_comments_post_mortem_id_post_mortems_id_fk" FOREIGN KEY ("post_mortem_id") REFERENCES "app"."post_mortems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_mortem_comments" ADD CONSTRAINT "post_mortem_comments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_mortem_revisions" ADD CONSTRAINT "post_mortem_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "directory"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_mortem_revisions" ADD CONSTRAINT "post_mortem_revisions_post_mortem_id_post_mortems_id_fk" FOREIGN KEY ("post_mortem_id") REFERENCES "app"."post_mortems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_mortem_revisions" ADD CONSTRAINT "post_mortem_revisions_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_mortem_comments_pm" ON "app"."post_mortem_comments" USING btree ("post_mortem_id");--> statement-breakpoint
CREATE INDEX "post_mortem_revisions_pm_created" ON "app"."post_mortem_revisions" USING btree ("post_mortem_id","created_at");--> statement-breakpoint
ALTER TABLE "app"."post_mortems" ADD CONSTRAINT "post_mortems_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "app"."members"("id") ON DELETE set null ON UPDATE no action;