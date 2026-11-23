CREATE TABLE "masar"."office_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"user_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "masar"."office_settings" ADD CONSTRAINT "office_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "masar"."users"("id") ON DELETE set null ON UPDATE no action;