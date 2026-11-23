"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { clientOfDeal } from "@/server/documents/service";
import { closeLinks, openLink } from "@/server/messages/links";
import { linkPath, linkSecret, siteOrigin, whatsapp } from "@/server/messages/request";
import { markHandled } from "@/server/messages/inbox";
import { noteSent, sendMessage } from "@/server/messages/service";
import { DomainError } from "@/server/shared/errors";

/** What a message action answers: how it went out, or the code of why it did not. */
export interface MessageAnswer {
  error?: string;
  done?: "text" | "template" | "noted";
}

const id = z.coerce.number().int().positive();
const text = z.string().max(5000);

/** The conversation changed: its page, and the count of who waits for an answer on every page. */
const refresh = (dealId: number): void => {
  revalidatePath("/", "layout");
  revalidatePath(`/deals/${dealId}/messages`);
};

async function answer(run: () => Promise<MessageAnswer>): Promise<MessageAnswer> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    throw error;
  }
}

/** Sends a message to the client from the company's number. */
export async function sendFromOffice(dealId: number, kind: string, body: string): Promise<MessageAnswer> {
  const actor = await requireActor("client.edit");
  // The demo's clients are invented and so are their numbers: nothing leaves it.
  if (actor.demo) return { error: "DEMO" };
  const deal = id.safeParse(dealId);
  const said = text.safeParse(body);
  if (!deal.success) return { error: "NOT_FOUND" };
  if (!said.success) return { error: "INVALID_INPUT" };
  const origin = await siteOrigin();
  if (!origin) return { error: "NO_SITE" };
  return answer(async () => {
    const sent = await sendMessage(await getDb(), {
      dealId: deal.data,
      kind,
      body: said.data,
      actor,
      cloud: whatsapp(),
      secret: linkSecret(),
      linkUrl: (token) => `${origin}${linkPath(token)}`,
    }).finally(() => refresh(deal.data));
    return { done: sent.via };
  });
}

/** Records a message the person is sending from their own WhatsApp, so the file shows what was said. */
export async function noteOwnSend(dealId: number, kind: string, body: string): Promise<MessageAnswer> {
  const actor = await requireActor("client.edit");
  if (actor.demo) return { error: "DEMO" };
  const deal = id.safeParse(dealId);
  const said = text.safeParse(body);
  if (!deal.success) return { error: "NOT_FOUND" };
  if (!said.success) return { error: "INVALID_INPUT" };
  return answer(async () => {
    await noteSent(await getDb(), { dealId: deal.data, kind, body: said.data, actor });
    refresh(deal.data);
    return { done: "noted" };
  });
}

/** Opens a link for the client of a deal. */
export async function makeLink(formData: FormData): Promise<void> {
  const actor = await requireActor("client.edit");
  // The demo's links are the same on every copy of it, so none is opened or closed there.
  if (actor.demo) return;
  const deal = id.safeParse(formData.get("dealId"));
  if (!deal.success) return;
  await answer(async () => {
    await openLink(await getDb(), { dealId: deal.data, secret: linkSecret(), actor });
    return {};
  });
  refresh(deal.data);
}

/** Closes every link of the client of a deal. */
export async function shutLinks(formData: FormData): Promise<void> {
  const actor = await requireActor("client.edit");
  if (actor.demo) return;
  const deal = id.safeParse(formData.get("dealId"));
  if (!deal.success) return;
  const db = await getDb();
  const clientId = await clientOfDeal(db, deal.data);
  if (clientId == null) return;
  await closeLinks(db, { clientId, actor });
  refresh(deal.data);
}

/** Says what the client last wrote needs no answer, so the conversation stops waiting. */
export async function needsNoAnswer(formData: FormData): Promise<void> {
  const actor = await requireActor("client.edit");
  const deal = id.safeParse(formData.get("dealId"));
  if (!deal.success) return;
  const db = await getDb();
  const clientId = await clientOfDeal(db, deal.data);
  if (clientId == null) return;
  await markHandled(db, { clientId }, actor);
  refresh(deal.data);
}
