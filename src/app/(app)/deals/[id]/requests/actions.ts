"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { approveRequest, closeRequest, prepareRequest, recordSent, recordShareConsent, withdrawShareConsent } from "@/server/requests/service";
import { DomainError } from "@/server/shared/errors";

export type RequestAnswer = {
  error?: string;
  params?: Record<string, string>;
  saved?: boolean;
};

const id = z.coerce.number().int().positive();

function refresh(dealId: number): void {
  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/deals/${dealId}/requests`);
  revalidatePath(`/deals/${dealId}/opportunities`);
  revalidatePath("/lenders/requests");
}

/** Runs one step and says what came of it: a refusal in its own code and words, or done. */
async function step(dealId: number, run: () => Promise<unknown>): Promise<RequestAnswer> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code, params: error.params };
    throw error;
  }
  refresh(dealId);
  return { saved: true };
}

/** Prepares a request to one lender on one opportunity of the deal. */
export async function prepare(dealId: number, routeKey: string, lenderId: number, _before: RequestAnswer, _form: FormData): Promise<RequestAnswer> {
  const actor = await requireActor("app.manage");
  return step(dealId, async () => prepareRequest(await getDb(), { dealId, routeKey, lenderId, actor }));
}

/** Signs a prepared request: what the lender will be told. The manager's step. */
export async function approve(dealId: number, requestId: number, _before: RequestAnswer, _form: FormData): Promise<RequestAnswer> {
  const actor = await requireActor("request.approve");
  return step(dealId, async () => approveRequest(await getDb(), { requestId, actor }));
}

/** Records that a person sent the approved message, through which way and on which day. */
export async function markSent(dealId: number, requestId: number, _before: RequestAnswer, form: FormData): Promise<RequestAnswer> {
  const actor = await requireActor("app.manage");
  const contactId = id.safeParse(String(form.get("contactId") ?? "").replace(/^c/, ""));
  if (!contactId.success) return { error: "SEND_REFUSED", params: { reason: "CONTACT" } };
  return step(dealId, async () =>
    recordSent(await getDb(), {
      requestId,
      input: {
        contactId: contactId.data,
        sentOn: String(form.get("sentOn") ?? ""),
      },
      actor,
    }),
  );
}

/** Closes a request still open, with why. */
export async function close(dealId: number, requestId: number, _before: RequestAnswer, form: FormData): Promise<RequestAnswer> {
  const actor = await requireActor("app.manage");
  return step(dealId, async () =>
    closeRequest(await getDb(), {
      requestId,
      reason: String(form.get("reason") ?? "") || null,
      actor,
    }),
  );
}

/** Records the client's consent to sharing their data with one lender. */
export async function giveConsent(dealId: number, clientId: number, _before: RequestAnswer, form: FormData): Promise<RequestAnswer> {
  const actor = await requireActor("client.edit");
  const lenderId = id.safeParse(String(form.get("lenderId") ?? "").replace(/^l/, ""));
  if (!lenderId.success) return { error: "INVALID_INPUT" };
  const note = String(form.get("note") ?? "").trim();
  return step(dealId, async () =>
    recordShareConsent(await getDb(), {
      clientId,
      input: {
        lenderId: lenderId.data,
        way: String(form.get("way") ?? ""),
        note: note || null,
        givenOn: String(form.get("givenOn") ?? ""),
      },
      actor,
    }),
  );
}

/** The client takes back their consent for one lender. */
export async function withdrawConsent(dealId: number, clientId: number, consentId: number, _before: RequestAnswer, _form: FormData): Promise<RequestAnswer> {
  const actor = await requireActor("client.edit");
  return step(dealId, async () => withdrawShareConsent(await getDb(), { clientId, consentId, actor }));
}
