import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { checklist, projectPapers, SIMAH_PAPER, type Checklist } from "@/domain/documents";
import type { ProjectFacts } from "@/domain/project";
import type { ClientRow } from "../clients/service";
import type { Db, Tx } from "../db/client";
import { clients, creditReports, documents } from "../db/schema";
import { keptPapers, whoOf, type PaperWho } from "../documents/service";
import { projectFactsOf } from "./input";

/**
 * The papers of each file that a person checked and that stand as good, by their codes. The SIMAH
 * report counts once it was read into the credit record: reading it is the check. Two queries,
 * however many files.
 */
export async function checkedPapers(db: Tx, clientIds: readonly number[]): Promise<Map<number, string[]>> {
  const checked = new Map<number, string[]>(clientIds.map((id) => [id, []]));
  if (!clientIds.length) return checked;
  const good = await db
    .select({ clientId: documents.clientId, code: documents.code })
    .from(documents)
    .where(and(inArray(documents.clientId, [...clientIds]), eq(documents.status, "verified")));
  for (const paper of good) if (paper.code !== SIMAH_PAPER) checked.get(paper.clientId)?.push(paper.code);
  const read = await db
    .selectDistinct({ clientId: creditReports.clientId })
    .from(creditReports)
    .where(inArray(creditReports.clientId, [...clientIds]));
  for (const report of read) checked.get(report.clientId)?.push(SIMAH_PAPER);
  return checked;
}

/** Whether a client's file is a project's, and whether it was rejected. Null when there is no such file, or it is not a project. */
export async function projectFile(db: Tx, clientId: number): Promise<{ rejected: boolean } | null> {
  const [client] = await db.select({ financeType: clients.financeType, status: clients.status }).from(clients).where(eq(clients.id, clientId));
  return client && client.financeType === "project" ? { rejected: client.status === "rejected" } : null;
}

/** Everything the papers page of a project shows. */
export interface ProjectPapersView {
  client: ClientRow;
  who: PaperWho;
  facts: ProjectFacts;
  list: Checklist;
  /** The file was rejected. Its papers are kept to be read, and nothing is added to them. */
  rejected: boolean;
}

/** A project's file held against the papers a lender asks of a project. Null when there is no such file, or it is not a project. */
export async function getProjectPapers(db: Db, clientId: number): Promise<ProjectPapersView | null> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client || client.financeType !== "project") return null;
  const facts = projectFactsOf(client.extra);
  const who = whoOf(client);
  const [report] = await db.select({ id: creditReports.id }).from(creditReports).where(eq(creditReports.clientId, client.id)).limit(1);
  const list = checklist(projectPapers(facts, who.nationality), await keptPapers(db, client.id), { creditRead: report != null });
  // A project's valuation is the owner's own report. The office orders none here, so every paper is the owner's to bring.
  for (const paper of list.papers) paper.by = "client";
  return { client, who, facts, list, rejected: client.status === "rejected" };
}
