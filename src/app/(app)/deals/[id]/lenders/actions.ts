"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { applyRoute, setSalaryBank } from "@/server/funding/service";
import { DomainError } from "@/server/shared/errors";

const id = z.coerce.number().int().positive();
const chooseSchema = z.object({ dealId: id, key: z.string().regex(/^[mp]\d+(-p\d+)?$/) });

function refresh(dealId: number): void {
  revalidatePath("/");
  revalidatePath("/deals");
  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/deals/${dealId}/lenders`);
}

/**
 * Puts a lender's terms on the deal. The service works the routes out again and refuses what no longer
 * holds, and the page says why.
 */
export async function chooseRoute(formData: FormData): Promise<void> {
  const actor = await requireActor("deal.edit");
  const parsed = chooseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { dealId, key } = parsed.data;
  let refused: string | null = null;
  try {
    await applyRoute(await getDb(), { dealId, key, actor });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    refused = error.code;
  }
  refresh(dealId);
  redirect(refused ? `/deals/${dealId}/lenders?refused=${refused}` : `/deals/${dealId}/lenders`, RedirectType.replace);
}

const bankSchema = z.object({ dealId: id, clientId: id, bankCode: z.string().trim().max(40).nullable() });

/** Records where the client's salary is paid. The lenders that want it moved are worked out again. */
export async function saveSalaryBank(input: { dealId: number; clientId: number; bankCode: string | null }): Promise<void> {
  const actor = await requireActor("client.edit");
  const parsed = bankSchema.safeParse(input);
  if (!parsed.success) return;
  const { dealId, clientId, bankCode } = parsed.data;
  try {
    await setSalaryBank(await getDb(), { clientId, bankCode: bankCode || null, actor });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
  }
  refresh(dealId);
}
