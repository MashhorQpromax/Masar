"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { STAGES } from "@/domain/deal";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
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
