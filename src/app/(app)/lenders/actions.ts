"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { updateProductTerms } from "@/server/lenders/service";
import { DomainError } from "@/server/shared/errors";

export interface TermsAnswer {
  error?: string;
  saved?: boolean;
}

/** Saves a product's corrected terms. The service checks every value: nothing sent from the browser is trusted. */
export async function saveProductTerms(productId: number, terms: unknown): Promise<TermsAnswer> {
  const actor = await requireActor("lender.manage");
  const id = z.number().int().positive().safeParse(productId);
  if (!id.success) return { error: "NOT_FOUND" };
  try {
    await updateProductTerms(await getDb(), { productId: id.data, terms, actor });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    throw error;
  }
  revalidatePath("/lenders");
  return { saved: true };
}
