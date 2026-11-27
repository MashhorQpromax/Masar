"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@/domain/auth";
import { STAGES } from "@/domain/deal";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { recordCollectedFee } from "@/server/deals/collected";
import { approveFeePlan } from "@/server/deals/plan";
import { setDealStage } from "@/server/deals/service";
import { DomainError } from "@/server/shared/errors";

const moveSchema = z.object({
  dealId: z.coerce.number().int().positive(),
  stage: z.enum(STAGES.map(([stage]) => stage) as [string, ...string[]]),
});

/** Moves a deal to another stage of its road. The service checks the stage belongs to the deal. */
export async function moveDealStage(formData: FormData): Promise<void> {
  const actor = await requireActor("deal.edit");
  const { dealId, stage } = moveSchema.parse({ dealId: formData.get("dealId"), stage: formData.get("stage") });
  await setDealStage(await getDb(), { dealId, stage: stage as (typeof STAGES)[number][0], actor });
  revalidatePath("/");
  revalidatePath("/deals");
  revalidatePath(`/deals/${dealId}`);
}

export type PlanAnswer = { error?: string; params?: Record<string, string> };

/** Approves a deal's fee plan as the stored numbers give it now. A refusal comes back as a code. */
export async function approvePlan(dealId: number, _before: PlanAnswer, _form: FormData): Promise<PlanAnswer> {
  const actor = await requireActor("fee.approve");
  try {
    await approveFeePlan(await getDb(), { dealId, actor });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code, params: error.params };
    throw error;
  }
  revalidatePath(`/deals/${dealId}`);
  return {};
}

export type CollectedAnswer = { error?: string; params?: Record<string, string>; saved?: boolean };

/** An amount as the form sends it: empty takes the recorded amount back. */
const collectedSchema = z
  .string()
  .trim()
  .max(20)
  .transform((text) => (text === "" ? null : Number(text)));

/**
 * Records what the office collected of a closed deal's fee. It is the office's income as a person
 * reports it, so it is taken from whoever may set a deal's fee, and the log keeps who said what.
 */
export async function recordCollected(dealId: number, _before: CollectedAnswer, form: FormData): Promise<CollectedAnswer> {
  const actor = await requireActor();
  if (!can(actor.role, "fee.set")) return { error: "FORBIDDEN" };
  const amount = collectedSchema.safeParse(form.get("amount") ?? "");
  if (!amount.success || Number.isNaN(amount.data)) return { error: "COLLECTED_REFUSED", params: { reason: "AMOUNT" } };
  try {
    await recordCollectedFee(await getDb(), { dealId, amount: amount.data, actor });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code, params: error.params };
    throw error;
  }
  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/reports");
  return { saved: true };
}
