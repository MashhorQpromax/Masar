"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FILE_MAX_BYTES } from "@/domain/documents";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { addPaper, addPaperFile, clientOfDeal, removePaper, removePaperFile, reviewPaper } from "@/server/documents/service";
import { DomainError } from "@/server/shared/errors";

/** What a paper action answers: nothing when it worked, or the code of why it did not. */
export interface PaperAnswer {
  error?: string;
  done?: boolean;
}

const id = z.coerce.number().int().positive();
const codeSchema = z.string().min(1).max(60);

function refresh(dealId: number): void {
  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/deals/${dealId}/documents`);
}

/** Runs a change on the papers of a deal's client, and turns an expected refusal into its code. */
async function change(dealId: unknown, run: (clientId: number) => Promise<void>): Promise<PaperAnswer> {
  const deal = id.safeParse(dealId);
  if (!deal.success) return { error: "NOT_FOUND" };
  const clientId = await clientOfDeal(await getDb(), deal.data);
  if (clientId == null) return { error: "NOT_FOUND" };
  try {
    await run(clientId);
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    throw error;
  }
  refresh(deal.data);
  return { done: true };
}

/** Keeps one file under a paper. The browser sends files one by one, so each request stays small. */
export async function uploadPaperFile(dealId: number, code: string, formData: FormData): Promise<PaperAnswer> {
  const actor = await requireActor("doc.upload");
  // A build without a database holds invented clients only. A real person's papers are never taken there.
  if (actor.demo) return { error: "DEMO" };
  const paper = codeSchema.safeParse(code);
  const file = formData.get("file");
  if (!paper.success) return { error: "NOT_FOUND" };
  if (!(file instanceof File) || file.size === 0) return { error: "NO_FILE" };
  if (file.size > FILE_MAX_BYTES) return { error: "FILE_TOO_LARGE" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  return change(dealId, async (clientId) => {
    await addPaperFile(await getDb(), { clientId, code: paper.data, file: { name: file.name, bytes }, actor });
  });
}

/** Removes a kept file. */
export async function removeFile(formData: FormData): Promise<void> {
  const actor = await requireActor("doc.upload");
  const fileId = id.safeParse(formData.get("fileId"));
  if (!fileId.success) return;
  await change(formData.get("dealId"), async (clientId) => removePaperFile(await getDb(), { clientId, fileId: fileId.data, actor }));
}

/** Says a paper is good, or sends it back with the reason the form carries. */
export async function judgePaper(formData: FormData): Promise<void> {
  const actor = await requireActor("doc.verify");
  const paperId = id.safeParse(formData.get("paperId"));
  if (!paperId.success) return;
  const review = { verdict: formData.get("verdict"), note: formData.get("note") ?? "" };
  await change(formData.get("dealId"), async (clientId) => reviewPaper(await getDb(), { clientId, paperId: paperId.data, review, actor }));
}

/** Adds a paper by name to the file. */
export async function addPaperByName(dealId: number, _previous: PaperAnswer, formData: FormData): Promise<PaperAnswer> {
  const actor = await requireActor("doc.upload");
  return change(dealId, async (clientId) => {
    await addPaper(await getDb(), { clientId, label: formData.get("label"), actor });
  });
}

/** Takes back a paper a person added. */
export async function dropPaper(formData: FormData): Promise<void> {
  const actor = await requireActor("doc.upload");
  const paperId = id.safeParse(formData.get("paperId"));
  if (!paperId.success) return;
  await change(formData.get("dealId"), async (clientId) => removePaper(await getDb(), { clientId, paperId: paperId.data, actor }));
}
