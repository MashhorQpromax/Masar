import { z } from "zod";
import { CONDITION_TEXT_MAX, CONTRACT_TYPES, INQUIRIES_MAX, PRODUCT_KINDS, REFERENCE_MAX, REFERENCE_MIN, SECTORS, SOURCE_KINDS, TERMS, type ContractType, type Nationality, type Sector } from "@/domain/eligibility";

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

/** What confirms some of a product's terms: which terms, the kind of source, and what names it. */
export const termSourceSchema = z.object({
  terms: z.array(z.enum(TERMS)).min(1).refine(each),
  kind: z.enum(SOURCE_KINDS),
  reference: z
    .string()
    .max(REFERENCE_MAX * 4)
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(REFERENCE_MIN).max(REFERENCE_MAX)),
  /** The day the source was checked. Left out, it is today. */
  confirmedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type TermSourceInput = z.infer<typeof termSourceSchema>;

/** A person's words about a condition, on one line. Nothing written reads as nothing said. */
const words = z
  .string()
  .max(CONDITION_TEXT_MAX * 4)
  .nullish()
  .transform((value) => value?.replace(/\s+/g, " ").trim() || null)
  .pipe(z.string().max(CONDITION_TEXT_MAX).nullable());

const unmet = z.enum(["block", "action"]);

/** A special condition as a person adds it to a product. Each kind carries only what it measures or asks. */
export const conditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("min_amount"), amount: z.number().min(1000).max(10_000_000_000) }),
  z.object({ kind: z.literal("inquiries"), count: z.number().int().min(0).max(INQUIRIES_MAX), months: z.union([z.literal(6), z.literal(12)]) }),
  z.object({ kind: z.literal("contract"), contracts: z.array(z.enum(CONTRACT_TYPES)).min(1).refine(each).transform(inOrder<ContractType>(CONTRACT_TYPES)) }),
  z.object({ kind: z.enum(["employer", "guarantor", "collateral"]), text: words, unmet }),
  // A condition of no known kind is only its words.
  z.object({ kind: z.literal("other"), text: words.pipe(z.string().min(3)), unmet }),
]);

export type ConditionInput = z.infer<typeof conditionSchema>;
