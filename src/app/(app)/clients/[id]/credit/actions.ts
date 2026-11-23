"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseSimahPages, REPORT_MAX_BYTES } from "@/domain/credit";
import { requireActor } from "@/server/auth/actor";
import { looksLikePdf, pdfPages } from "@/server/credit/pdf";
import { addCreditReport, getCredit, reviewCreditReport } from "@/server/credit/service";
import { getDb } from "@/server/db/client";
import { riyadhDay } from "@/server/shared/clock";
import { DomainError } from "@/server/shared/errors";

/** What a credit action answers: what was read when it worked, or the code of why it did not. */
export interface CreditAnswer {
  error?: string;
  read?: { facilities: number; judgments: number };
  saved?: boolean;
}

const idSchema = z.coerce.number().int().positive();

async function refresh(clientId: number): Promise<void> {
  revalidatePath(`/clients/${clientId}/credit`);
  const view = await getCredit(await getDb(), clientId);
  if (view?.dealId) {
    revalidatePath(`/deals/${view.dealId}`);
    revalidatePath(`/deals/${view.dealId}/documents`);
  }
  revalidatePath("/");
}

/**
 * Reads a SIMAH report from the PDF as SIMAH issued it, and stores the reading as the client's record.
 * The file itself is kept with the client's papers.
 */
export async function uploadReport(clientId: number, _previous: CreditAnswer, formData: FormData): Promise<CreditAnswer> {
  const actor = await requireActor("doc.upload");
  // A build without a database holds invented clients only. A real person's report is never taken there.
  if (actor.demo) return { error: "DEMO" };
  const id = idSchema.safeParse(clientId);
  if (!id.success) return { error: "NOT_FOUND" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "NO_FILE" };
  if (file.size > REPORT_MAX_BYTES) return { error: "TOO_LARGE" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) return { error: "NOT_PDF" };

  let pages: string[];
  try {
    pages = await pdfPages(bytes);
  } catch {
    return { error: "UNREADABLE" };
  }
  const now = new Date();
  const reading = parseSimahPages(pages, riyadhDay(now));
  const { facilities, judgments, summary } = reading.report;
  if (!facilities.length && !judgments.length && summary?.activeCount == null) return { error: "NOT_SIMAH" };

  try {
    await addCreditReport(await getDb(), { clientId: id.data, reading, file: { name: file.name, bytes }, actor, now });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    throw error;
  }
  await refresh(id.data);
  return { read: { facilities: facilities.length, judgments: judgments.length } };
}

const answerSchema = z.object({ clientId: idSchema, reportId: idSchema, suspension: z.enum(["yes", "no"]) });

/** One tap after checking Absher or Najiz: the suspension the reading assumed is real, or it is not. */
export async function answerSuspension(formData: FormData): Promise<void> {
  const actor = await requireActor("client.edit");
  const parsed = answerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { clientId, reportId, suspension } = parsed.data;
  await reviewCreditReport(await getDb(), {
    clientId,
    reportId,
    review: { suspension: suspension === "yes", travelBan: null, note: null },
    actor,
  });
  await refresh(clientId);
}

const reviewForm = z.object({
  reportId: idSchema,
  suspension: z.enum(["yes", "no", "keep"]),
  travelBan: z.enum(["yes", "no"]),
  note: z.string().max(4000),
});

/** What a person found beyond the report: the suspension, a travel ban, and a note for whoever reads the file next. */
export async function saveReview(clientId: number, _previous: CreditAnswer, formData: FormData): Promise<CreditAnswer> {
  const actor = await requireActor("client.edit");
  const id = idSchema.safeParse(clientId);
  const parsed = reviewForm.safeParse({
    reportId: formData.get("reportId"),
    suspension: formData.get("suspension") ?? "keep",
    travelBan: formData.get("travelBan") ?? "no",
    note: formData.get("note") ?? "",
  });
  if (!id.success || !parsed.success) return { error: "INVALID_INPUT" };
  const { reportId, suspension, travelBan, note } = parsed.data;
  try {
    await reviewCreditReport(await getDb(), {
      clientId: id.data,
      reportId,
      review: { suspension: suspension === "keep" ? null : suspension === "yes", travelBan: travelBan === "yes", note },
      actor,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    throw error;
  }
  await refresh(id.data);
  return { saved: true };
}
