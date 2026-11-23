import { z } from "zod";

/** The terms of a product that a person may correct, with the limits the deal engine accepts. */
export const productTermsSchema = z.object({
  rate: z.number().min(0).max(30),
  rateType: z.enum(["flat", "reducing"]),
  maxAmount: z.number().min(0).max(10_000_000_000),
  maxTenor: z.number().int().min(1).max(420),
  maxAgeAtMaturity: z.number().int().min(40).max(90),
  minSalary: z.number().min(0).max(10_000_000),
  minServiceMonths: z.number().int().min(0).max(720),
  /** For a mortgage: the most of the property's value the lender finances, percent. */
  maxLtv: z.number().min(0).max(100).nullable(),
  requiresSalaryTransfer: z.boolean(),
  acceptsLateSimah: z.boolean(),
  /** Months the lender waits after a default was paid. 0 takes the client at once. Null: nobody has confirmed it. */
  settledDefaultWaitMonths: z.number().int().min(0).max(120).nullable(),
  /** Someone confirmed these terms with the lender. */
  verified: z.boolean(),
});

export type ProductTerms = z.infer<typeof productTermsSchema>;
