ALTER TABLE "masar"."products" ADD COLUMN "settled_default_wait_months" integer;--> statement-breakpoint
ALTER TABLE "masar"."deals" ADD COLUMN "mortgage_ceiling" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "masar"."deals" ADD COLUMN "personal_ceiling" numeric(14, 2);