import "server-only";
import { and, eq } from "drizzle-orm";
import { addMonths, dayOf, termsOf, type FinanceType, type SourceKind } from "@/domain/eligibility";
import type { Db } from "../db/client";
import { lenders, termSources, users } from "../db/schema";
import { addLender, addProduct, confirmTerms } from "../lenders/service";
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
 */
export const DEMO_BANK = "بنك المثال";
export const DEMO_COMPANY = "المثال للتمويل";

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
    },
    {
      financeType: "mortgage",
      name: "التمويل العقاري",
      sectors: SALARIED,
      terms: { rate: 4.8, rateType: "reducing", maxAmount: 5_000_000, maxTenor: 300, maxAgeAtMaturity: 70, minSalary: 5000, minServiceMonths: 3, maxLtv: 90, requiresSalaryTransfer: true, acceptsLateSimah: false, settledDefaultWaitMonths: 0 },
      source: { kind: "lender_document", reference: DEMO_PAPER },
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
    },
    // Waits a year after a default is paid, in writing: a confirmed refusal for a deal that pays one now.
    {
      financeType: "mortgage",
      name: "تمويل المسكن",
      sectors: SALARIED,
      terms: { rate: 6.2, rateType: "reducing", maxAmount: 3_000_000, maxTenor: 300, maxAgeAtMaturity: 70, minSalary: 5000, minServiceMonths: 6, maxLtv: 85, requiresSalaryTransfer: false, acceptsLateSimah: false, settledDefaultWaitMonths: 12 },
      source: { kind: "lender_document", reference: DEMO_PAPER },
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
  for (const [name, type] of [
    [DEMO_BANK, "bank"],
    [DEMO_COMPANY, "finance_company"],
  ] as const) {
    const { lenderId } = await addLender(db, { input: { name, type }, actor });
    for (const product of PRODUCTS[name]!) {
      const { productId } = await addProduct(db, { lenderId, input: { financeType: product.financeType, scope: { name: product.name, sectors: product.sectors, nationalities: ["saudi"], minAge: 21 }, terms: product.terms }, actor });
      await confirmTerms(db, { productId, input: { ...product.source, terms: termsOf(product.financeType) }, actor, now });
      ids[`${name}:${product.financeType}`] = productId;
    }
  }
  // The bank's margin was read four months ago and nobody asked again: its confirmation ran out.
  // The service refuses a source this old, so the row is written as it would stand had time passed.
  await db
    .update(termSources)
    .set({ confirmedOn: addMonths(dayOf(now), -4) })
    .where(and(eq(termSources.productId, ids[`${DEMO_BANK}:mortgage`]!), eq(termSources.term, "rate")));
}
