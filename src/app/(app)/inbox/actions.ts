"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { normalizePhone } from "@/domain/shared/phone";
import { requireActor } from "@/server/auth/actor";
import { getClientCard } from "@/server/clients/directory";
import { getDb } from "@/server/db/client";
import { claimNumber, markHandled } from "@/server/messages/inbox";
import { DomainError } from "@/server/shared/errors";

const claimSchema = z.object({ phone: z.string().min(5).max(20), clientId: z.coerce.number().int().positive() });

/**
 * Says a number of no file is this client's. The number goes on their file and what it wrote joins
 * their conversation, where the person lands to answer it.
 */
export async function claim(formData: FormData): Promise<void> {
  const actor = await requireActor("client.edit");
  const parsed = claimSchema.safeParse(Object.fromEntries(formData));
  const phone = parsed.success ? normalizePhone(parsed.data.phone) : null;
  if (!parsed.success || !phone) redirect("/inbox");
  const db = await getDb();
  let refused: string | null = null;
  try {
    await claimNumber(db, { phone, clientId: parsed.data.clientId, actor });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    refused = error.code;
  }
  revalidatePath("/", "layout");
  if (refused) redirect(`/inbox/${phone}?refused=${refused}`, RedirectType.replace);
  const deal = (await getClientCard(db, parsed.data.clientId))?.deals[0];
  redirect(deal ? `/deals/${deal.id}/messages` : `/clients/${parsed.data.clientId}`, RedirectType.replace);
}

/** Says what a number of no file wrote needs no answer. */
export async function strangerHandled(formData: FormData): Promise<void> {
  const actor = await requireActor("client.edit");
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (phone) await markHandled(await getDb(), { phone }, actor);
  revalidatePath("/", "layout");
  redirect("/inbox", RedirectType.replace);
}
