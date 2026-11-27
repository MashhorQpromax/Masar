"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { addRule, archiveRule } from "@/server/knowledge/service";
import { DomainError } from "@/server/shared/errors";

export interface NoteAnswer {
  error?: string;
  saved?: boolean;
}

/** Writes a note about a lender down. The service checks every value: nothing sent from the browser is trusted. */
export async function saveNote(rule: unknown): Promise<NoteAnswer> {
  const actor = await requireActor("client.edit");
  try {
    await addRule(await getDb(), { rule, actor });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    throw error;
  }
  revalidatePath("/lenders/knowledge");
  return { saved: true };
}

const id = z.coerce.number().int().positive();

/** Takes a note off the screens. A note that is already gone changes nothing. */
export async function removeNote(formData: FormData): Promise<void> {
  const actor = await requireActor("lender.manage");
  const ruleId = id.safeParse(formData.get("ruleId"));
  if (!ruleId.success) return;
  try {
    await archiveRule(await getDb(), { ruleId: ruleId.data, actor });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
  }
  revalidatePath("/lenders/knowledge");
}
