"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { reviseDeal, startDeal } from "@/server/deals/service";
import { DomainError } from "@/server/shared/errors";

const formSchema = z.object({
  dealId: z.number().int().positive().nullable(),
  borrower: z.unknown(),
  input: z.unknown(),
});

/**
 * Saves the deal editor: a new client with their first deal, or new numbers for a deal in progress.
 * The services validate the borrower and the numbers and recompute everything; nothing computed in the
 * browser is trusted. On success the person lands on the deal's page, which takes the editor's place in
 * the history so that Back does not reopen a form already saved. A refusal comes back as a code.
 */
export async function saveDealForm(form: unknown): Promise<{ error: string }> {
  const actor = await requireActor();
  const parsed = formSchema.safeParse(form);
  if (!parsed.success) return { error: "INVALID_INPUT" };
  const { dealId, borrower, input } = parsed.data;

  let saved: number;
  try {
    const db = await getDb();
    saved =
      dealId == null
        ? (await startDeal(db, { borrower, input, actor })).dealId
        : (await reviseDeal(db, { dealId, borrower, input, actor })).dealId;
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    throw error;
  }
  revalidatePath("/");
  revalidatePath("/deals");
  revalidatePath(`/deals/${saved}`);
  redirect(`/deals/${saved}`, RedirectType.replace);
}
