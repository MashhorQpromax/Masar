import "server-only";
import { desc, eq } from "drizzle-orm";
import { analyzeClient, reportAgeMonths, type ClientAnalysis, type FileConflict, type FileFacts } from "@/domain/analysis";
import { contractOf, PRODUCT_KINDS, SECTORS, type Answer, type ProductKind, type Sector } from "@/domain/eligibility";
import { answersOf } from "../clients/conditions";
import type { ClientRow } from "../clients/service";
import { latestCredit, type CreditRecord } from "../credit/service";
import type { Db } from "../db/client";
import { clients, deals, lenders } from "../db/schema";
import { conflictsOf, fileStanding } from "../documents/facts";
import { listProducts } from "../lenders/service";
import { riyadhDay } from "../shared/clock";

const ENDED = ["closed", "lost"];

/** What a client's file says about them, as the analysis reads it in a given year. */
export function fileFacts(client: ClientRow, args: { incomeVerified: boolean; now: Date; answers?: Readonly<Record<string, Answer>>; conflicts?: readonly FileConflict[] }): FileFacts {
  const kind = (PRODUCT_KINDS as readonly string[]).includes(client.financeType) ? (client.financeType as ProductKind) : null;
  return {
    age: client.birthYear != null ? args.now.getFullYear() - client.birthYear : null,
    nationality: client.nationality === "non_saudi" ? "non_saudi" : "saudi",
    sector: (SECTORS as readonly string[]).includes(client.sector) ? (client.sector as Sector) : "gov",
    serviceMonths: client.serviceMonths,
    basicSalary: client.basicSalary,
    totalSalary: client.totalSalary,
    otherIncome: client.otherIncome,
    coIncome: client.coIncome,
    salaryBank: client.salaryBank,
    housingSupport: client.housingSupport,
    propertyValue: client.propertyValue,
    request: kind ? { kind, amount: client.requestedAmount, tenor: client.requestedTenor } : null,
    incomeVerified: args.incomeVerified,
    consent: client.consentAt != null,
    contractType: contractOf(client.contractType),
    answers: args.answers ?? {},
    conflicts: args.conflicts ?? [],
  };
}

/** Everything the analysis page shows about one client. */
export interface AnalysisView {
  client: ClientRow;
  /** The client's newest deal, and whether it is still on the road. */
  deal: { id: number; open: boolean } | null;
  /** The client's newest credit record. Null when none was ever read. */
  record: CreditRecord | null;
  file: FileFacts;
  /** The name of the bank the salary is paid into, when the catalogue knows it. */
  salaryBank: string | null;
  /** Null until a credit record is read: there is nothing to analyse before it. */
  analysis: ClientAnalysis | null;
}

/**
 * A client's credit and financial analysis, worked out now from what is stored: the file, the newest
 * credit record and the catalogue as it stands. Nothing of it is kept, so it never falls behind them.
 */
export async function getAnalysis(db: Db, args: { clientId: number; now?: Date }): Promise<AnalysisView | null> {
  const now = args.now ?? new Date();
  const [client] = await db.select().from(clients).where(eq(clients.id, args.clientId));
  if (!client) return null;
  const [deal] = await db.select({ id: deals.id, stage: deals.stage }).from(deals).where(eq(deals.clientId, client.id)).orderBy(desc(deals.id)).limit(1);
  // The income is proven by a checked paper that states it, not by a paper having been looked at.
  const standing = await fileStanding(db, client);
  const [bank] = client.salaryBank ? await db.select({ name: lenders.name }).from(lenders).where(eq(lenders.bankCode, client.salaryBank)).limit(1) : [];
  const record = await latestCredit(db, client.id);
  const file = fileFacts(client, { incomeVerified: standing.incomeProven, now, answers: await answersOf(db, client.id), conflicts: conflictsOf(standing) });
  const analysis = record
    ? analyzeClient({
        file,
        record: {
          report: record.report,
          analysis: record.analysis,
          confidence: record.confidence,
          // That a suspension was assumed is a gap of its own, with its own question.
          readingWarnings: record.warnings.filter((warning) => warning.code !== "SUSPENSION_ASSUMED").length,
          ageMonths: record.report.reportDate ? reportAgeMonths(record.report.reportDate, riyadhDay(now)) : null,
        },
        products: await listProducts(db, { now }),
      })
    : null;
  return { client, deal: deal ? { id: deal.id, open: !ENDED.includes(deal.stage) } : null, record, file, salaryBank: bank?.name ?? null, analysis };
}
