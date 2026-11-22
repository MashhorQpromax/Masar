import { z } from "zod";
import type { DealInput } from "@/domain/deal";

/** A number here is always finite: the schema refuses NaN and Infinity by itself. */
const amount = z.number().min(0).max(10_000_000_000);
const pct = z.number().min(0).max(100);
const rate = z.number().min(0).max(30);

export const dealItemSchema = z.object({
  id: z.string().trim().min(1).max(20),
  kind: z.enum(["execution", "default", "mortgage_payoff", "personal_payoff", "card", "other"]),
  label: z.string().trim().max(200),
  original: amount,
  pay: amount,
  by: z.enum(["company", "bank", "out"]),
  confirmed: z.boolean().optional(),
  monthly: amount.nullable().optional(),
});

/** Everything a person can enter for a deal, with the limits the screens enforce. */
export const dealInputSchema = z
  .object({
    structure: z.enum(["settle_refi_personal", "settle_personal", "settle_refi"]),
    items: z.array(dealItemSchema).max(60),
    propertyValue: amount.nullable(),
    transferTaxPct: pct,
    saleTaxPct: pct,
    fixedCosts: amount,
    fee: z.object({
      settlePct: pct,
      settleIncludesPayoff: z.boolean(),
      financePct: pct,
      financeBase: z.enum(["total", "personal", "mortgage"]),
      fixed: amount,
    }),
    targetBank: z.string().trim().max(60).nullable(),
    mortgageApr: rate,
    personalFlat: rate,
    personalMonths: z.number().int().min(1).max(120),
    mortgageMaxAge: z.number().int().min(40).max(90),
    mortgageMaxMonths: z.number().int().min(12).max(420),
    ltvPct: pct,
    bankMortgage: amount.nullable(),
    bankPersonal: amount.nullable(),
    personalLender: z.string().trim().max(60).nullable().optional(),
    personalLenderKind: z.enum(["bank", "finance_co"]).nullable().optional(),
    notes: z.string().max(4000),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.items.forEach((item, index) => {
      if (seen.has(item.id)) ctx.addIssue({ code: "custom", path: ["items", index, "id"], message: "duplicate item id" });
      seen.add(item.id);
    });
  });

export function parseDealInput(value: unknown): DealInput {
  return dealInputSchema.parse(value);
}
