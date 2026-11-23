"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { numberText } from "@/copy/format";
import { can } from "@/domain/auth";
import { FILE_MAX_BYTES } from "@/domain/documents";
import { PAPER_FACTS, type PaperFact } from "@/domain/eligibility";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { relyOnPaper, statePaper } from "@/server/documents/facts";
import { addPaper, addPaperFile, clientOfDeal, movePaperFile, removePaper, removePaperFile, reviewPaper } from "@/server/documents/service";
import { projectFile } from "@/server/projects/papers";
import { DomainError } from "@/server/shared/errors";

/** What a paper action answers: nothing when it worked, or the code of why it did not. */
export interface PaperAnswer {
  error?: string;
  done?: boolean;
}

const id = z.coerce.number().int().positive();
const codeSchema = z.string().min(1).max(60);

/**
 * Whose papers a page holds, as its forms carry it: the client of a deal ("d12"), or a project's own
 * file ("p7"), which has no deal. The same papers, the same rules, two places they are read from.
 */
const HOME = /^([dp])([1-9]\d{0,9})$/;

/** The client a home's papers belong to, and the pages to draw again once they change. Null when there is no such home. */
async function homeOf(home: unknown): Promise<{ clientId: number; refresh: () => void } | null> {
  const [, kind, digits] = (typeof home === "string" ? HOME.exec(home) : null) ?? [];
  if (!kind) return null;
  const key = Number(digits);
  const db = await getDb();
  if (kind === "d") {
    const clientId = await clientOfDeal(db, key);
    if (clientId == null) return null;
    return {
      clientId,
      refresh: () => {
        revalidatePath(`/deals/${key}`);
        revalidatePath(`/deals/${key}/documents`);
      },
    };
  }
  // A project's file that was rejected keeps its papers as they are.
  const file = await projectFile(db, key);
  if (!file || file.rejected) return null;
  return {
    clientId: key,
    refresh: () => {
      revalidatePath(`/clients/${key}`);
      revalidatePath(`/clients/${key}/project`);
      revalidatePath(`/clients/${key}/project/papers`);
      revalidatePath("/clients");
    },
  };
}

/** The figures a person typed for a paper, as numbers. A field left empty is a figure nobody wrote. */
function figuresOf(formData: FormData): Partial<Record<PaperFact, number>> {
  const stated: Partial<Record<PaperFact, number>> = {};
  for (const fact of PAPER_FACTS) {
    const typed = formData.get(fact);
    const text = typeof typed === "string" ? numberText(typed, fact === "birthYear" ? 0 : 2) : "";
    if (text !== "") stated[fact] = Number(text);
  }
  return stated;
}

/** Runs a change on the papers of a home's client, and turns an expected refusal into its code. */
async function change(home: unknown, run: (clientId: number) => Promise<void>): Promise<PaperAnswer> {
  const found = await homeOf(home);
  if (!found) return { error: "NOT_FOUND" };
  try {
    await run(found.clientId);
  } catch (error) {
    // A refusal that says what is wrong with a figure is worded by that, not by the refusal's own name.
    if (error instanceof DomainError) return { error: error.params.problem ?? error.code };
    throw error;
  }
  found.refresh();
  return { done: true };
}

/** Keeps one file under a paper. The browser sends files one by one, so each request stays small. */
export async function uploadPaperFile(home: string, code: string, formData: FormData): Promise<PaperAnswer> {
  const actor = await requireActor("doc.upload");
  // A build without a database holds invented clients only. A real person's papers are never taken there.
  if (actor.demo) return { error: "DEMO" };
  const paper = codeSchema.safeParse(code);
  const file = formData.get("file");
  if (!paper.success) return { error: "NOT_FOUND" };
  if (!(file instanceof File) || file.size === 0) return { error: "NO_FILE" };
  if (file.size > FILE_MAX_BYTES) return { error: "FILE_TOO_LARGE" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  return change(home, async (clientId) => {
    await addPaperFile(await getDb(), { clientId, code: paper.data, file: { name: file.name, bytes }, actor });
  });
}

/** Removes a kept file. */
export async function removeFile(formData: FormData): Promise<void> {
  const actor = await requireActor("doc.upload");
  const fileId = id.safeParse(formData.get("fileId"));
  if (!fileId.success) return;
  await change(formData.get("home"), async (clientId) => removePaperFile(await getDb(), { clientId, fileId: fileId.data, actor }));
}

/** Says a paper is good, or sends it back with the reason the form carries. */
export async function judgePaper(formData: FormData): Promise<void> {
  const actor = await requireActor("doc.verify");
  const paperId = id.safeParse(formData.get("paperId"));
  if (!paperId.success) return;
  const review = { verdict: formData.get("verdict"), note: formData.get("note") ?? "" };
  await change(formData.get("home"), async (clientId) => reviewPaper(await getDb(), { clientId, paperId: paperId.data, review, actor }));
}

/** Says a paper is good and keeps the figures the person wrote down from it. */
export async function verifyPaper(home: string, paperId: number, _previous: PaperAnswer, formData: FormData): Promise<PaperAnswer> {
  const actor = await requireActor("doc.verify");
  return change(home, async (clientId) => reviewPaper(await getDb(), { clientId, paperId, review: { verdict: "verified", stated: figuresOf(formData) }, actor }));
}

/** Writes down, or corrects, the figures a checked paper states. */
export async function stateFigures(home: string, paperId: number, _previous: PaperAnswer, formData: FormData): Promise<PaperAnswer> {
  const actor = await requireActor("doc.verify");
  return change(home, async (clientId) => statePaper(await getDb(), { clientId, paperId, stated: figuresOf(formData), actor }));
}

/** The file takes what a checked paper says about a fact in dispute. It changes the file, so it takes both rights. */
export async function relyOn(home: string, paperId: number, fact: PaperFact, _previous: PaperAnswer, _formData: FormData): Promise<PaperAnswer> {
  const actor = await requireActor("doc.verify");
  if (!can(actor.role, "client.edit")) return { error: "FORBIDDEN" };
  const answer = await change(home, async (clientId) => relyOnPaper(await getDb(), { clientId, paperId, fact, actor }));
  // The salary and the age feed every screen of the deal.
  if (answer.done) revalidatePath("/", "layout");
  return answer;
}

/** Adds a paper by name to the file. */
export async function addPaperByName(home: string, _previous: PaperAnswer, formData: FormData): Promise<PaperAnswer> {
  const actor = await requireActor("doc.upload");
  return change(home, async (clientId) => {
    await addPaper(await getDb(), { clientId, label: formData.get("label"), actor });
  });
}

/** Takes back a paper a person added. */
export async function dropPaper(formData: FormData): Promise<void> {
  const actor = await requireActor("doc.upload");
  const paperId = id.safeParse(formData.get("paperId"));
  if (!paperId.success) return;
  await change(formData.get("home"), async (clientId) => removePaper(await getDb(), { clientId, paperId: paperId.data, actor }));
}

/** Puts a file that arrived by WhatsApp under the paper it is. */
export async function fileUnder(formData: FormData): Promise<void> {
  const actor = await requireActor("doc.upload");
  const fileId = id.safeParse(formData.get("fileId"));
  const paper = codeSchema.safeParse(formData.get("code"));
  if (!fileId.success || !paper.success) return;
  await change(formData.get("home"), async (clientId) => {
    await movePaperFile(await getDb(), { clientId, fileId: fileId.data, code: paper.data, actor });
  });
}
