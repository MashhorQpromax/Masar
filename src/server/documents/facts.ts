import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { ZodError, z } from "zod";
import { disputedFacts, incomeProven, readFacts, relyProblem, statedOf, type FactReading, type Stated, type StatedPaper } from "@/domain/documents";
import { PAPER_FACTS, type PaperFact } from "@/domain/eligibility";
import type { ClientRow } from "../clients/service";
import type { Db, Tx } from "../db/client";
import { clients, documents } from "../db/schema";
import { recomputeOpenDeal } from "../deals/service";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { statedSchema } from "./input";
import { statedFor } from "./stated";

/** The client's checked papers, each with the figures a person wrote down from it. */
export async function statedPapers(db: Tx, clientId: number): Promise<StatedPaper[]> {
  const rows = await db
    .select({ id: documents.id, code: documents.code, label: documents.label, stated: documents.stated })
    .from(documents)
    .where(and(eq(documents.clientId, clientId), eq(documents.status, "verified")))
    .orderBy(asc(documents.id));
  return rows.map((row) => ({ id: row.id, code: row.code, label: row.label, stated: statedOf(row.code, row.stated) }));
}

/** What the file holds of the facts a paper states too. */
export const fileFigures = (client: Pick<ClientRow, PaperFact>): Record<PaperFact, number | null> => ({
  totalSalary: client.totalSalary,
  basicSalary: client.basicSalary,
  birthYear: client.birthYear,
});

/** A client's file held against their checked papers, with what follows from it for every study of them. */
export interface FileStanding {
  /** Every fact a paper can state, with what the file and the papers say. */
  readings: FactReading[];
  /** The facts in dispute. While there is one, no lender is answered. */
  disputed: PaperFact[];
  /** A checked paper states the salary the income is counted from, and agrees with the file. */
  incomeProven: boolean;
}

/** Holds a client's file against their checked papers. */
export async function fileStanding(db: Tx, client: Pick<ClientRow, "id" | PaperFact>): Promise<FileStanding> {
  const readings = readFacts(fileFigures(client), await statedPapers(db, client.id));
  return { readings, disputed: disputedFacts(readings), incomeProven: incomeProven(readings) };
}

/** The disputed facts as the analysis words them: each with what the file and every paper says. */
export const conflictsOf = (standing: Pick<FileStanding, "readings">) =>
  standing.readings.filter((reading) => reading.state === "conflict").map((reading) => ({ fact: reading.fact, file: reading.file, stated: reading.stated.map(({ code, label, value }) => ({ code, label, value })) }));

function parsed<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ZodError) throw new DomainError("INVALID_INPUT", error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    throw error;
  }
}

const sameFigures = (a: Stated, b: Stated): boolean => PAPER_FACTS.every((fact) => (a[fact] ?? null) === (b[fact] ?? null));

/**
 * Writes down, or corrects, the figures a checked paper states. Only a paper that stands as verified
 * takes them: what a paper says is written by the person who looked at it and found it good. An empty
 * set takes back what was written.
 */
export async function statePaper(db: Db, args: { clientId: number; paperId: number; stated: unknown; actor: Actor; now?: Date }): Promise<void> {
  const given = parsed(() => statedSchema.parse(args.stated));
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const [paper] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, args.paperId), eq(documents.clientId, args.clientId)))
      .for("update");
    if (!paper) throw new DomainError("NOT_FOUND", `paper ${args.paperId}`);
    if (paper.status !== "verified") throw new DomainError("FIGURE_REFUSED", `paper ${paper.code} is not verified`, { problem: "NOT_VERIFIED" });
    const stated = statedFor(paper.code, given, now);
    const before = statedOf(paper.code, paper.stated);
    if (sameFigures(before, stated)) return;
    await tx
      .update(documents)
      .set({ stated: Object.keys(stated).length ? stated : null, updatedAt: now })
      .where(eq(documents.id, paper.id));
    await audit(tx, args.actor, "doc.state", "client", args.clientId, { paper: paper.code, stated, before });
  });
}

const SALARIES: readonly PaperFact[] = ["totalSalary", "basicSalary"];
const factSchema = z.enum(PAPER_FACTS);

/**
 * The file takes what a checked paper says about a fact in dispute. It can when the checked papers
 * agree among themselves, so the file is the one that differs. A paper that states both salaries
 * gives both where both are in dispute: one salary of a paper beside the other of the old file is a
 * file no paper states. The client's deal in progress is computed again on the new figures.
 */
export async function relyOnPaper(db: Db, args: { clientId: number; paperId: number; fact: unknown; actor: Actor; now?: Date }): Promise<void> {
  const fact = parsed(() => factSchema.parse(args.fact));
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const [client] = await tx.select().from(clients).where(eq(clients.id, args.clientId)).for("update");
    if (!client) throw new DomainError("NOT_FOUND", `client ${args.clientId}`);
    const { readings } = await fileStanding(tx, client);
    const of = (name: PaperFact) => readings.find((reading) => reading.fact === name)!;
    const problem = relyProblem(of(fact), args.paperId);
    if (problem) throw new DomainError("RELY_REFUSED", `${fact} of paper ${args.paperId}: ${problem}`, { problem });

    const taken = (SALARIES.includes(fact) ? SALARIES : [fact]).filter((name) => name === fact || relyProblem(of(name), args.paperId) == null);
    const next = fileFigures(client);
    const changes: Partial<Record<PaperFact, { from: number | null; to: number }>> = {};
    for (const name of taken) {
      const to = of(name).stated.find((statement) => statement.paperId === args.paperId)!.value;
      changes[name] = { from: client[name], to };
      next[name] = to;
    }
    // A basic salary above the total is a file no engine reads. The other figure is corrected by hand first.
    if (next.basicSalary != null && next.totalSalary != null && next.basicSalary > next.totalSalary) {
      throw new DomainError("RELY_REFUSED", `${fact} of paper ${args.paperId}: basic above total`, { problem: "FILE_BASIC_ABOVE_TOTAL" });
    }
    const [paper] = await tx.select({ code: documents.code }).from(documents).where(eq(documents.id, args.paperId));
    await tx
      .update(clients)
      .set({ ...Object.fromEntries(taken.map((name) => [name, next[name]])), updatedAt: now })
      .where(eq(clients.id, client.id));
    await audit(tx, args.actor, "client.fact_rely", "client", client.id, { paper: paper?.code ?? null, changes });
    await recomputeOpenDeal(tx, { clientId: client.id, actor: args.actor, now });
  });
}
