"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { STAGES } from "@/domain/deal";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { setDealStage } from "@/server/deals/service";

const moveSchema = z.object({
  dealId: z.coerce.number().int().positive(),
  stage: z.enum(STAGES.map(([stage]) => stage) as [string, ...string[]]),
});

/** Moves a deal to another stage of its road. The service checks the stage belongs to the deal. */
export async function moveDealStage(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const { dealId, stage } = moveSchema.parse({ dealId: formData.get("dealId"), stage: formData.get("stage") });
  await setDealStage(await getDb(), { dealId, stage: stage as (typeof STAGES)[number][0], actor });
  revalidatePath("/");
  revalidatePath("/deals");
  revalidatePath(`/deals/${dealId}`);
}
