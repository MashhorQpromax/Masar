import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { analyzeCredit, type CreditAnalysis, type CreditReport, type ParsedReport, type ParseWarning } from "@/domain/credit";
import { SIMAH_PAPER } from "@/domain/documents";
import type { Db, Tx } from "../db/client";
import { clients, creditReports, deals } from "../db/schema";
import { keepFile } from "../documents/service";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { parseReading, parseStored, reviewSchema, type Reading, type Review, type StoredCredit } from "./input";

/** A client's credit record as it was read, with what it means today. */
export interface CreditRecord {
  id: number;
  clientId: number;
  createdAt: Date;
  report: CreditReport;
  warnings: ParseWarning[];
  /** How sure the reading was. Null for a record nobody read from a file. */
  confidence: ParsedReport["confidence"] | null;
  analysis: CreditAnalysis;
}

function valid<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ZodError) {
      throw new DomainError("INVALID_INPUT", error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    throw error;
  }
}

const stored = (value: StoredCredit) => ({ ...value.report, warnings: value.warnings, confidence: value.confidence });

async function latestRow(tx: Tx, clientId: number) {
  const [row] = await tx.select().from(creditReports).where(eq(creditReports.clientId, clientId)).orderBy(desc(creditReports.id)).limit(1);
  return row;
}

/**
 * Stores a reading of a client's SIMAH report and grades it. Each reading is kept: the newest one is
 * the client's record, and the older ones are its history. The PDF it was read from, when there is
 * one, is kept with the client's papers.
 */
export async function addCreditReport(
  db: Db,
  args: { clientId: number; reading: unknown; file?: { name: string; bytes: Uint8Array }; actor: Actor; now?: Date },
): Promise<{ reportId: number; analysis: CreditAnalysis }> {
  const reading: Reading = valid(() => parseReading(args.reading));
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, args.clientId));
    if (!client) throw new DomainError("NOT_FOUND", `client ${args.clientId}`);
    const analysis = analyzeCredit(reading.report);
    // A client is read many times over the years. The paper keeps the newest files and lets the oldest go.
    const kept = args.file ? await keepFile(tx, { clientId: client.id, code: SIMAH_PAPER, ...args.file, actor: args.actor, now, makeRoom: true }) : null;
    const [row] = await tx
      .insert(creditReports)
      .values({
        clientId: client.id,
        report: stored(reading),
        grade: analysis.grade,
        derivedSimah: analysis.standing,
        fileId: kept?.fileId ?? null,
        userId: args.actor.userId,
        createdAt: now,
      })
      .returning({ id: creditReports.id });
    await tx.update(clients).set({ simah: analysis.standing, updatedAt: now }).where(eq(clients.id, client.id));
    await audit(tx, args.actor, "credit.report_add", "client", client.id, {
      reportId: row!.id,
      grade: analysis.grade,
      facilities: reading.report.facilities.length,
      judgments: reading.report.judgments.length,
      confidence: reading.confidence,
    });
    return { reportId: row!.id, analysis };
  });
}

/**
 * Records what a person found in Absher or Najiz: whether the service suspension is real, whether
 * there is a travel ban, and a note. The record is graded again.
 */
export async function reviewCreditReport(
  db: Db,
  args: { clientId: number; reportId: number; review: unknown; actor: Actor; now?: Date },
): Promise<{ analysis: CreditAnalysis }> {
  const review: Review = valid(() => reviewSchema.parse(args.review));
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(creditReports)
      .where(and(eq(creditReports.id, args.reportId), eq(creditReports.clientId, args.clientId)));
    if (!row) throw new DomainError("NOT_FOUND", `credit report ${args.reportId}`);
    const current = parseStored(row.report);
    const report: CreditReport = { ...current.report };
    if (review.travelBan !== null) report.travelBan = review.travelBan;
    if (review.suspension !== null) {
      report.serviceSuspension = review.suspension;
      report.suspensionAssumed = false;
    }
    // A note is the whole note: saving it blank removes it. Null leaves it as it is.
    if (review.note !== null) report.notes = review.note || null;
    const analysis = analyzeCredit(report);
    await tx
      .update(creditReports)
      .set({ report: stored({ ...current, report }), grade: analysis.grade, derivedSimah: analysis.standing })
      .where(eq(creditReports.id, row.id));
    // The client's standing follows their newest record only. Reviewing an older one changes history, not today.
    if ((await latestRow(tx, args.clientId))?.id === row.id) {
      await tx.update(clients).set({ simah: analysis.standing, updatedAt: now }).where(eq(clients.id, args.clientId));
    }
    await audit(tx, args.actor, "credit.report_review", "client", args.clientId, {
      reportId: row.id,
      suspension: review.suspension,
      travelBan: review.travelBan,
      note: !!review.note,
      grade: analysis.grade,
    });
    return { analysis };
  });
}

/** The client's newest credit record, graded as of now. Null when none was ever read. */
export async function latestCredit(db: Tx, clientId: number): Promise<CreditRecord | null> {
  const row = await latestRow(db, clientId);
  if (!row) return null;
  const { report, warnings, confidence } = parseStored(row.report);
  return { id: row.id, clientId: row.clientId, createdAt: row.createdAt, report, warnings, confidence, analysis: analyzeCredit(report) };
}

/** Every reading kept for a client, newest first, with the grade it had when stored. */
export async function creditHistory(db: Tx, clientId: number): Promise<{ id: number; createdAt: Date; grade: string | null }[]> {
  return db
    .select({ id: creditReports.id, createdAt: creditReports.createdAt, grade: creditReports.grade })
    .from(creditReports)
    .where(eq(creditReports.clientId, clientId))
    .orderBy(desc(creditReports.id));
}

/** Everything the credit page shows about one client. */
export interface CreditView {
  client: { id: number; fileNo: string; fullName: string };
  /** The client's newest deal, where the page leads back to. */
  dealId: number | null;
  record: CreditRecord | null;
  history: { id: number; createdAt: Date; grade: string | null }[];
}

export async function getCredit(db: Tx, clientId: number): Promise<CreditView | null> {
  const [client] = await db.select({ id: clients.id, fileNo: clients.fileNo, fullName: clients.fullName }).from(clients).where(eq(clients.id, clientId));
  if (!client) return null;
  const [deal] = await db.select({ id: deals.id }).from(deals).where(eq(deals.clientId, client.id)).orderBy(desc(deals.id)).limit(1);
  return { client, dealId: deal?.id ?? null, record: await latestCredit(db, client.id), history: await creditHistory(db, client.id) };
}
