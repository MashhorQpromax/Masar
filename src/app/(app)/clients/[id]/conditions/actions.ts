"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/actor";
import { answerCondition } from "@/server/clients/conditions";
import { getDb } from "@/server/db/client";
import { DomainError } from "@/server/shared/errors";

const schema = z.object({
  clientId: z.coerce.number().int().positive(),
  conditionId: z.coerce.number().int().positive(),
  /** Empty takes the answer back. */
  answer: z.enum(["met", "unmet", ""]),
});

/**
 * Records what a person answered about a client and one of a lender's special conditions. Every page
 * that judges the lender for this client is worked out again from it.
 */
export async function answerAsked(form: FormData): Promise<void> {
  const actor = await requireActor("client.edit");
  const asked = schema.safeParse({ clientId: form.get("clientId"), conditionId: form.get("conditionId"), answer: form.get("answer") ?? "" });
  if (!asked.success) return;
  const { clientId, conditionId, answer } = asked.data;
  try {
    await answerCondition(await getDb(), { clientId, conditionId, answer: answer || null, actor });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
  }
  revalidatePath(`/clients/${clientId}/conditions`);
  revalidatePath(`/clients/${clientId}/analysis`);
}
