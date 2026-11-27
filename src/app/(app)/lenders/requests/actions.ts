"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { setFollowUpDays } from "@/server/settings/requests";
import { DomainError } from "@/server/shared/errors";

export type FollowUpAnswer = { error?: string; saved?: boolean };

/** Sets how many days the office waits for a lender's answer before it follows up. The manager's call. */
export async function saveFollowUp(_before: FollowUpAnswer, form: FormData): Promise<FollowUpAnswer> {
  const actor = await requireActor("settings.manage");
  try {
    await setFollowUpDays(await getDb(), {
      days: Number(form.get("days")),
      actor,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    throw error;
  }
  revalidatePath("/lenders/requests");
  revalidatePath("/deals/[id]/requests", "page");
  return { saved: true };
}
