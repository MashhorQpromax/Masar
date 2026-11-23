import { z } from "zod";
import { PRODUCT_KINDS, SECTORS, type Nationality, type Sector } from "@/domain/eligibility";

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

const NATIONALITIES = ["saudi", "non_saudi"] as const satisfies readonly Nationality[];
const each = <T,>(list: T[]): boolean => new Set(list).size === list.length;
/** A list of choices kept in the order the choices are always shown in, so two equal lists compare equal. */
const inOrder = <T extends string>(all: readonly T[]) => (list: T[]): T[] => all.filter((item) => list.includes(item));

/** What a product is called and who it is given to. */
export const productScopeSchema = z.object({
  name: z
    .string()
    .max(320)
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(2).max(80)),
  sectors: z.array(z.enum(SECTORS)).min(1).refine(each).transform(inOrder<Sector>(SECTORS)),
  nationalities: z.array(z.enum(NATIONALITIES)).min(1).refine(each).transform(inOrder<Nationality>(NATIONALITIES)),
  minAge: z.number().int().min(18).max(70),
});

export type ProductScope = z.infer<typeof productScopeSchema>;

/** A product as a person adds it to a lender. */
export const newProductSchema = z.object({
  financeType: z.enum(PRODUCT_KINDS),
  scope: productScopeSchema,
  terms: productTermsSchema,
});

/** A lender as a person adds it to the catalogue. */
export const newLenderSchema = z.object({
  name: z
    .string()
    .max(320)
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(2).max(80)),
  type: z.enum(["bank", "finance_company"]),
});
