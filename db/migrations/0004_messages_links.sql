ALTER TABLE "masar"."wa_messages" DROP CONSTRAINT "wa_messages_doc_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "masar"."share_links" ADD COLUMN "seed" text NOT NULL;--> statement-breakpoint
ALTER TABLE "masar"."wa_messages" ADD COLUMN "file_id" integer;--> statement-breakpoint
ALTER TABLE "masar"."wa_messages" ADD CONSTRAINT "wa_messages_file_id_document_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "masar"."document_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "masar"."wa_messages" DROP COLUMN "doc_id";