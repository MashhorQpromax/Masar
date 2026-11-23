"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { can } from "@/domain/auth";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { reviseDeal, startDeal, startDealFor } from "@/server/deals/service";
import { DomainError } from "@/server/shared/errors";

const formSchema = z.object({
  dealId: z.number().int().positive().nullable(),
  /** A new deal for a client who already has a file. */
  clientId: z.number().int().positive().nullable().default(null),
  /** The mobile of a client whose file is being opened. */
  phone: z.string().max(40).nullable().default(null),
  borrower: z.unknown(),
  input: z.unknown(),
});

/**
 * Saves the deal editor: a new client with their first deal, a new deal for a client who has a file,
 * or new numbers for a deal in progress.
 * The services validate the borrower and the numbers and recompute everything; nothing computed in the
 * browser is trusted. On success the person lands on the deal's page, which takes the editor's place in
 * the history so that Back does not reopen a form already saved. A refusal comes back as a code.
 */
export async function saveDealForm(form: unknown): Promise<{ error: string; params?: Record<string, string> }> {
  const actor = await requireActor();
  const parsed = formSchema.safeParse(form);
  if (!parsed.success) return { error: "INVALID_INPUT" };
  const { dealId, clientId, phone, borrower, input } = parsed.data;
  // Opening a file and changing a deal's numbers are two permissions.
  if (!can(actor.role, dealId == null && clientId == null ? "client.create" : "deal.edit")) return { error: "FORBIDDEN" };

  let saved: number;
  try {
    const db = await getDb();
    saved =
      dealId != null
        ? (await reviseDeal(db, { dealId, borrower, input, actor })).dealId
        : clientId != null
          ? (await startDealFor(db, { clientId, borrower, input, actor })).dealId
          : (await startDeal(db, { borrower, input, phone, actor })).dealId;
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code, params: error.params };
    throw error;
  }
  revalidatePath("/", "layout");
  revalidatePath("/deals");
  revalidatePath(`/deals/${saved}`);
  redirect(`/deals/${saved}`, RedirectType.replace);
}
