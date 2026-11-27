"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { setFeePolicy } from "@/server/settings/fees";
import { DomainError } from "@/server/shared/errors";

export type PolicyAnswer = { ok?: boolean; error?: string; params?: Record<string, string> };

/** Keeps the office's fee policy. The service checks it; a refusal comes back as a code. */
export async function saveFeePolicy(input: unknown): Promise<PolicyAnswer> {
  const actor = await requireActor("settings.manage");
  try {
    await setFeePolicy(await getDb(), { input, actor });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code, params: error.params };
    throw error;
  }
  revalidatePath("/settings/fees");
  return { ok: true };
}
