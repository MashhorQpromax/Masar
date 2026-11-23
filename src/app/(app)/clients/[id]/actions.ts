"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/auth/actor";
import { addNote, updateContact } from "@/server/clients/service";
import { getDb } from "@/server/db/client";
import { rejectDeal, reopenDeal } from "@/server/deals/service";
import { DomainError } from "@/server/shared/errors";

/** What a form on a client's file is told after it was sent. */
export interface CardAnswer {
  done?: boolean;
  error?: string;
  /** What the wording of the error needs, such as the file a phone already belongs to. */
  params?: Record<string, string>;
  /** How many messages joined the file with its new number. */
  adopted?: number;
}

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

function refresh(clientId: number): void {
  revalidatePath("/", "layout");
  revalidatePath(`/clients/${clientId}`);
}

/** Runs a change and turns an expected refusal into a code the form can word. */
async function attempt(run: () => Promise<CardAnswer | void>): Promise<CardAnswer> {
  try {
    return (await run()) ?? { done: true };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code, params: error.params };
    throw error;
  }
}

/** Saves how a client is reached and who they are on paper. The service checks every field. */
export async function saveContact(clientId: number, _before: CardAnswer, form: FormData): Promise<CardAnswer> {
  const actor = await requireActor("client.edit");
  return attempt(async () => {
    const { adopted } = await updateContact(await getDb(), {
      clientId,
      input: {
        phone: field(form, "phone"),
        nationality: field(form, "nationality"),
        nationalId: field(form, "nationalId"),
        employer: field(form, "employer"),
        city: field(form, "city"),
        email: field(form, "email"),
      },
      actor,
    });
    refresh(clientId);
    return { done: true, adopted };
  });
}

/** Leaves a note on the file. */
export async function leaveNote(clientId: number, _before: CardAnswer, form: FormData): Promise<CardAnswer> {
  const actor = await requireActor("client.edit");
  return attempt(async () => {
    await addNote(await getDb(), { clientId, body: field(form, "body"), actor });
    refresh(clientId);
  });
}

/**
 * Rejects the file, or puts a rejected file back under study. Either way the reason is asked for: it
 * is what the next person to open the file reads.
 */
export async function decideFile(clientId: number, decision: "reject" | "reopen", _before: CardAnswer, form: FormData): Promise<CardAnswer> {
  const actor = await requireActor("deal.edit");
  const reason = field(form, "reason").replace(/\s+/g, " ").trim().slice(0, 500);
  if (reason.length < 3) return { error: "REASON_EMPTY" };
  return attempt(async () => {
    const db = await getDb();
    if (decision === "reject") await rejectDeal(db, { clientId, reason, actor });
    else await reopenDeal(db, { clientId, note: reason, actor });
    revalidatePath("/deals");
    refresh(clientId);
  });
}
