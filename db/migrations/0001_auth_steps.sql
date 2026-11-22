CREATE TYPE "masar"."auth_step_kind" AS ENUM('second_factor', 'passkey_login', 'passkey_register');--> statement-breakpoint
CREATE TABLE "masar"."auth_steps" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"kind" "masar"."auth_step_kind" NOT NULL,
	"user_id" integer,
	"challenge" text,
	"remember" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "masar"."sessions" ADD COLUMN "method" text NOT NULL;--> statement-breakpoint
ALTER TABLE "masar"."sessions" ADD COLUMN "confirmed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "masar"."auth_steps" ADD CONSTRAINT "auth_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "masar"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_steps_expires_idx" ON "masar"."auth_steps" USING btree ("expires_at");