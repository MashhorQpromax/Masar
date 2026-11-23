"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TERMS } from "@/domain/eligibility";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { addLender, addProduct, confirmTerms, setProductActive, updateProductTerms, withdrawTerms } from "@/server/lenders/service";
import { DomainError } from "@/server/shared/errors";

export interface TermsAnswer {
  error?: string;
  /** What the wording of a refusal needs beyond its code. */
  params?: Record<string, string>;
  saved?: boolean;
  /** Terms whose value changed and whose confirmation fell with it. */
  dropped?: number;
}

const id = z.number().int().positive();

/** Every page that reads the catalogue. A deal's own lenders page reads it afresh on each visit. */
function catalogueChanged(): void {
  revalidatePath("/lenders");
  revalidatePath("/lenders/calculator");
  revalidatePath("/lenders/knowledge");
}

const refusal = (error: unknown): TermsAnswer => {
  if (error instanceof DomainError) return { error: error.code, params: error.params };
  throw error;
};

/** Saves a product's corrected terms and who it is given to. The service checks every value: nothing sent from the browser is trusted. */
export async function saveProductTerms(productId: number, terms: unknown, scope?: unknown): Promise<TermsAnswer> {
  const actor = await requireActor("lender.manage");
  const product = id.safeParse(productId);
  if (!product.success) return { error: "NOT_FOUND" };
  try {
    const { unconfirmed } = await updateProductTerms(await getDb(), { productId: product.data, terms, scope, actor });
    catalogueChanged();
    return { saved: true, dropped: unconfirmed.length };
  } catch (error) {
    return refusal(error);
  }
}

/** Adds a lender. It starts with no product, so the next step is its first one. */
export async function saveLender(input: unknown): Promise<TermsAnswer> {
  const actor = await requireActor("lender.manage");
  try {
    await addLender(await getDb(), { input, actor });
  } catch (error) {
    return refusal(error);
  }
  catalogueChanged();
  return { saved: true };
}

/** Adds a product to a lender. */
export async function saveProduct(lenderId: number, input: unknown): Promise<TermsAnswer> {
  const actor = await requireActor("lender.manage");
  const lender = id.safeParse(lenderId);
  if (!lender.success) return { error: "NOT_FOUND" };
  try {
    await addProduct(await getDb(), { lenderId: lender.data, input, actor });
  } catch (error) {
    return refusal(error);
  }
  catalogueChanged();
  return { saved: true };
}

/**
 * Confirms terms of a product with the source that states them. Only whoever may confirm a lender's
 * terms can: every result the office gives a client rests on what is confirmed here.
 */
export async function confirmProductTerms(productId: number, input: unknown): Promise<TermsAnswer> {
  const actor = await requireActor("lender.confirm");
  const product = id.safeParse(productId);
  if (!product.success) return { error: "NOT_FOUND" };
  try {
    await confirmTerms(await getDb(), { productId: product.data, input, actor });
  } catch (error) {
    return refusal(error);
  }
  catalogueChanged();
  return { saved: true };
}

const withdrawSchema = z.object({ productId: z.coerce.number().int().positive(), terms: z.array(z.enum(TERMS)).min(1).max(TERMS.length) });

/** Takes back what one source confirmed, when it turns out not to say what was thought. */
export async function withdrawProductTerms(formData: FormData): Promise<void> {
  const actor = await requireActor("lender.confirm");
  const asked = withdrawSchema.safeParse({ productId: formData.get("productId"), terms: formData.getAll("term") });
  if (!asked.success) return;
  try {
    await withdrawTerms(await getDb(), { productId: asked.data.productId, terms: asked.data.terms, actor });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
  }
  catalogueChanged();
}

const switchSchema = z.object({ productId: z.coerce.number().int().positive(), active: z.enum(["0", "1"]) });

/** Stops a product, or puts it back. A product that is already as asked changes nothing. */
export async function switchProduct(formData: FormData): Promise<void> {
  const actor = await requireActor("lender.manage");
  const asked = switchSchema.safeParse({ productId: formData.get("productId"), active: formData.get("active") });
  if (!asked.success) return;
  try {
    await setProductActive(await getDb(), { productId: asked.data.productId, active: asked.data.active === "1", actor });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
  }
  catalogueChanged();
}
