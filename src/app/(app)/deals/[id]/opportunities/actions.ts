"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { makeReport } from "@/server/opportunities/service";
import { DomainError } from "@/server/shared/errors";

export type ReportAnswer = { error?: string; params?: Record<string, string> };

/** Saves the study of the deal's opportunities as it stands now, and opens the saved copy. */
export async function saveReport(dealId: number, _before: ReportAnswer, _form: FormData): Promise<ReportAnswer> {
  const actor = await requireActor("deal.edit");
  let id: number;
  try {
    ({ id } = await makeReport(await getDb(), { dealId, actor }));
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code, params: error.params };
    throw error;
  }
  revalidatePath(`/deals/${dealId}/opportunities`);
  redirect(`/deals/${dealId}/opportunities/reports/${id}`);
}
