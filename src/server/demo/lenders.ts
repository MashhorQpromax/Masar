import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { addMonths, dayOf, termsOf, type FinanceType, type SourceKind } from "@/domain/eligibility";
import type { Db } from "../db/client";
import { answerCondition } from "../clients/conditions";
import { clients, deals, lenderRequests, lenders, outcomes, termSources, users } from "../db/schema";
import { addPaper, keepFile } from "../documents/service";
import { getFunding } from "../funding/service";
import { recordDecision } from "../knowledge/service";
import { addCondition, addLender, addProduct, confirmTerms } from "../lenders/service";
import { madeUpPdf } from "./seed";
import type { Actor } from "../shared/actor";

/**
 * Two lenders that exist only in the demonstration.
 *
 * The real lenders of the catalogue are never shown as confirmed there: nobody asked them, and a
 * made-up confirmation of a real lender's terms would be an invented policy. These two are named as
 * examples, with made-up terms and made-up sources that say so, so that every result of the strict
 * reading can be seen on invented deals: a confirmed answer in writing, one that rests on a word, a
 * confirmed refusal, and a confirmation that ran out. Neither takes a client of the private sector, so
 * one invented client is left with the real lenders alone, where every answer is still a question.
 *
 * Each of their products also shows one kind of special condition: a least amount, a limit of credit
 * inquiries, a kind of contract, and a guarantor, which only a person can answer for a client. One
 * invented client has that answer on file; for the others it is still a question to ask.
 */
export const DEMO_BANK = "بنك المثال";
export const DEMO_COMPANY = "المثال للتمويل";

/** The invented client whose answer about the guarantor is on file. */
export const DEMO_ANSWERED = "C-017";

/** What names a made-up source, so nobody reads it as something a lender said. */
export const DEMO_PAPER = "مستند تجريبي للعرض فقط";
export const DEMO_WORD = "إفادة تجريبية للعرض فقط";

const SALARIED = ["gov", "military", "semi_gov", "private_approved", "retired"];

interface DemoProduct {
  financeType: FinanceType;
  name: string;
  terms: Record<string, unknown>;
  sectors: string[];
  source: { kind: SourceKind; reference: string };
  /** What the lender asks beyond its terms. Written before the terms are confirmed, so the source speaks for the list too. */
  special?: Record<string, unknown>[];
}

const PRODUCTS: Record<string, DemoProduct[]> = {
  // Takes a client the day a default is paid, and wants the salary moved to it.
  [DEMO_BANK]: [
    {
      financeType: "personal",
      name: "التمويل الشخصي",
      sectors: SALARIED,
      terms: { rate: 3.3, rateType: "flat", maxAmount: 1_500_000, maxTenor: 60, maxAgeAtMaturity: 65, minSalary: 4000, minServiceMonths: 3, maxLtv: null, requiresSalaryTransfer: true, acceptsLateSimah: false, settledDefaultWaitMonths: 0 },
      source: { kind: "lender_document", reference: DEMO_PAPER },
      special: [{ kind: "min_amount", amount: 20_000 }],
    },
    {
      financeType: "mortgage",
      name: "التمويل العقاري",
      sectors: SALARIED,
      terms: { rate: 4.8, rateType: "reducing", maxAmount: 5_000_000, maxTenor: 300, maxAgeAtMaturity: 70, minSalary: 5000, minServiceMonths: 3, maxLtv: 90, requiresSalaryTransfer: true, acceptsLateSimah: false, settledDefaultWaitMonths: 0 },
      source: { kind: "lender_document", reference: DEMO_PAPER },
      special: [{ kind: "inquiries", count: 4, months: 6 }],
    },
  ],
  [DEMO_COMPANY]: [
    // Asks for no salary transfer and takes late payments: an employee said so, and nothing is in writing.
    {
      financeType: "personal",
      name: "تمويل نقدي",
      sectors: SALARIED,
      terms: { rate: 6.9, rateType: "flat", maxAmount: 300_000, maxTenor: 60, maxAgeAtMaturity: 65, minSalary: 3000, minServiceMonths: 3, maxLtv: null, requiresSalaryTransfer: false, acceptsLateSimah: true, settledDefaultWaitMonths: 0 },
      source: { kind: "lender_staff", reference: DEMO_WORD },
      special: [{ kind: "guarantor", text: "موظف حكومي على رأس العمل", unmet: "action" }],
    },
    // Waits a year after a default is paid, in writing. A deal that pays one now is not refused for it: the year is on its road.
    {
      financeType: "mortgage",
      name: "تمويل المسكن",
      sectors: SALARIED,
      terms: { rate: 6.2, rateType: "reducing", maxAmount: 3_000_000, maxTenor: 300, maxAgeAtMaturity: 70, minSalary: 5000, minServiceMonths: 6, maxLtv: 85, requiresSalaryTransfer: false, acceptsLateSimah: false, settledDefaultWaitMonths: 12 },
      source: { kind: "lender_document", reference: DEMO_PAPER },
      special: [{ kind: "contract", contracts: ["permanent"] }],
    },
  ],
};

/** Adds the two example lenders with their confirmed terms. Does nothing when they are already there. */
export async function seedDemoLenders(db: Db, now: Date): Promise<void> {
  const [known] = await db.select({ id: lenders.id }).from(lenders).where(eq(lenders.name, DEMO_BANK));
  if (known) return;
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).orderBy(users.id).limit(1);
  const actor: Actor = { userId: admin?.id ?? null };
  const ids: Record<string, number> = {};
  /** The conditions a person answers for each client. */
  const asked: number[] = [];
  for (const [name, type] of [
    [DEMO_BANK, "bank"],
    [DEMO_COMPANY, "finance_company"],
  ] as const) {
    const { lenderId } = await addLender(db, { input: { name, type }, actor });
    for (const product of PRODUCTS[name]!) {
      const { productId } = await addProduct(db, { lenderId, input: { financeType: product.financeType, scope: { name: product.name, sectors: product.sectors, nationalities: ["saudi"], minAge: 21 }, terms: product.terms }, actor });
      for (const input of product.special ?? []) {
        const { conditionId } = await addCondition(db, { productId, input, actor });
        if (input.kind === "guarantor") asked.push(conditionId);
      }
      await confirmTerms(db, { productId, input: { ...product.source, terms: termsOf(product.financeType) }, actor, now });
      ids[`${name}:${product.financeType}`] = productId;
    }
  }
  // One invented client was asked and has what the lender wants. Nobody asked the others yet.
  const [answered] = await db.select({ id: clients.id }).from(clients).where(eq(clients.fileNo, DEMO_ANSWERED));
  if (answered) for (const conditionId of asked) await answerCondition(db, { clientId: answered.id, conditionId, answer: "met", actor, now });
  // The bank's margin was read four months ago and nobody asked again: its confirmation ran out.
  // The service refuses a source this old, so the row is written as it would stand had time passed.
  await db
    .update(termSources)
    .set({ confirmedOn: addMonths(dayOf(now), -4) })
    .where(and(eq(termSources.productId, ids[`${DEMO_BANK}:mortgage`]!), eq(termSources.term, "rate")));
}

/** The invented client a lender said yes to in writing, and the one an example lender turned down. */
export const DEMO_REPLIED = "C-017";
export const DEMO_REFUSED = "C-014";

/** The bank's answer in its own words, as the demonstration has it. Made up, and says so. */
export const DEMO_REPLY_TEXT = "نص تجريبي للعرض فقط: نفيدكم بالموافقة المبدئية على طلب التمويل بالمبلغ المذكور، والموافقة النهائية بعد استكمال المستندات وتوقيع العميل.";

/**
 * What the example lenders answered about two invented clients. The bank said yes to one in a letter
 * kept in her file, so her opportunity with it reads as confirmed by the lender. The finance company
 * turned the other down, so his opportunity with it cannot be carried out. Both lenders and both
 * answers are made up. Does nothing when an answer with a written reply is already there.
 */
export async function seedDemoReplies(db: Db, now: Date): Promise<void> {
  const [known] = await db.select({ id: outcomes.id }).from(outcomes).where(isNotNull(outcomes.replyPaperId)).limit(1);
  if (known) return;
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).orderBy(users.id).limit(1);
  const actor: Actor = { userId: admin?.id ?? null };
  const lenderOf = new Map((await db.select({ id: lenders.id, name: lenders.name }).from(lenders)).map((l) => [l.name, l.id]));
  const dealOf = async (fileNo: string) => {
    const [row] = await db.select({ dealId: deals.id, clientId: clients.id }).from(deals).innerJoin(clients, eq(clients.id, deals.clientId)).where(eq(clients.fileNo, fileNo)).orderBy(desc(deals.id)).limit(1);
    return row ?? null;
  };
  const at = new Date(now.getTime() - 2 * 86_400_000);

  const replied = await dealOf(DEMO_REPLIED);
  const bank = lenderOf.get(DEMO_BANK);
  if (replied && bank) {
    const funding = await getFunding(db, { dealId: replied.dealId, now });
    const route = funding?.routes.find((r) => [r.mortgage, r.personal].every((leg) => !leg || leg.product.lenderName === DEMO_BANK));
    // The office's request to the bank, when one went out: the answer is written on it, the day it came.
    const [request] = await db
      .select({ id: lenderRequests.id })
      .from(lenderRequests)
      .where(and(eq(lenderRequests.dealId, replied.dealId), eq(lenderRequests.lenderId, bank), eq(lenderRequests.status, "sent")))
      .limit(1);
    const when = request ? now : at;
    if (route) {
      const { code } = await addPaper(db, { clientId: replied.clientId, label: `رد ${DEMO_BANK} المكتوب`, actor, now: when });
      const { paperId } = await db.transaction((tx) => keepFile(tx, { clientId: replied.clientId, code, name: "رد الجهة.pdf", bytes: madeUpPdf(`${DEMO_REPLIED} reply`), actor, now: when }));
      for (const part of ["mortgage", "personal"] as const) {
        const leg = route[part];
        if (!leg) continue;
        await recordDecision(db, {
          dealId: replied.dealId,
          decision: {
            lenderId: bank,
            part,
            decision: "approved",
            approvedAmount: leg.amount,
            asks: [],
            reason: null,
            note: "رد تجريبي للعرض فقط",
            onDeal: false,
            replyPaperId: paperId,
            requestId: request?.id ?? null,
            on: request ? dayOf(when) : null,
            replyText: request ? DEMO_REPLY_TEXT : null,
          },
          actor,
          now: when,
        });
      }
    }
  }

  const refused = await dealOf(DEMO_REFUSED);
  const company = lenderOf.get(DEMO_COMPANY);
  if (refused && company) {
    await recordDecision(db, {
      dealId: refused.dealId,
      decision: { lenderId: company, part: "personal", decision: "rejected", approvedAmount: null, asks: [], reason: "simah", note: "رفض تجريبي للعرض فقط", onDeal: false, replyPaperId: null },
      actor,
      now: at,
    });
  }
}
