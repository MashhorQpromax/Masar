import { z } from "zod";
import { BORROWER_TYPES, DEEDS, PROJECT_TYPES, PURPOSES, type ProjectFacts } from "@/domain/project";

/** A line a person may leave empty. Empty reads as "not known". */
const line = (max: number) =>
  z
    .string()
    .max(max * 4)
    .nullish()
    .transform((value) => value?.replace(/\s+/g, " ").trim().slice(0, max) || null);

/** A number a person may leave empty. Nothing and zero both read as "not known": no land is worth nothing. */
const upTo = (max: number) =>
  z
    .number()
    .finite()
    .min(0)
    .max(max)
    .nullable()
    .transform((value) => value || null);

/** The largest amount a project may be written with: a hundred billion. */
export const PROJECT_AMOUNT_MAX = 100_000_000_000;

const realDay = (text: string): boolean => {
  const day = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === text;
};

export const projectFactsSchema = z.object({
  borrowerType: z.enum(BORROWER_TYPES).nullable(),
  city: line(60),
  district: line(80),
  landArea: upTo(100_000_000),
  landValue: upTo(PROJECT_AMOUNT_MAX),
  valuer: line(120),
  /** The day of the valuation, yyyy-mm-dd. */
  valuationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(realDay)
    .nullable(),
  deed: z.enum(DEEDS).nullable(),
  projectType: z.enum(PROJECT_TYPES).nullable(),
  purpose: z.enum(PURPOSES).nullable(),
  constructionCost: upTo(PROJECT_AMOUNT_MAX),
  gfa: upTo(100_000_000),
  keys: upTo(100_000).pipe(z.number().int().nullable()),
  adr: upTo(1_000_000),
  occupancy: upTo(100),
  equityCash: upTo(PROJECT_AMOUNT_MAX),
  nearHaram: z.boolean(),
  hasPermit: z.boolean(),
  hasFeasibility: z.boolean(),
  existingLien: z.boolean(),
}) satisfies z.ZodType<ProjectFacts>;

/** A project as a person writes it: who owns it, what it asks for, and what is known about it. */
export const projectInputSchema = z.object({
  owner: z.string().trim().min(2).max(120),
  requested: z.number().finite().min(0).max(PROJECT_AMOUNT_MAX),
  facts: projectFactsSchema,
});

export type ProjectInput = z.infer<typeof projectInputSchema>;

/**
 * A project's facts as a client's file keeps them. The system that ran before the rebuild wrote them
 * too, as text, so each value is read on its own: what is not what it should be reads as not known.
 */
export function projectFactsOf(kept: unknown): ProjectFacts {
  let value = kept;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const from: Record<string, unknown> = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const number = (key: keyof ProjectFacts): number | null => (typeof from[key] === "number" && Number.isFinite(from[key]) && from[key] > 0 ? from[key] : null);
  const text = (key: keyof ProjectFacts): string | null => (typeof from[key] === "string" && from[key].trim() ? from[key].trim() : null);
  const one = <T extends string>(key: keyof ProjectFacts, all: readonly T[]): T | null => ((all as readonly unknown[]).includes(from[key]) ? (from[key] as T) : null);
  const day = text("valuationDate");
  return {
    borrowerType: one("borrowerType", BORROWER_TYPES),
    city: text("city"),
    district: text("district"),
    landArea: number("landArea"),
    landValue: number("landValue"),
    valuer: text("valuer"),
    valuationDate: day && /^\d{4}-\d{2}-\d{2}$/.test(day) && realDay(day) ? day : null,
    deed: one("deed", DEEDS),
    projectType: one("projectType", PROJECT_TYPES),
    purpose: one("purpose", PURPOSES),
    constructionCost: number("constructionCost"),
    gfa: number("gfa"),
    keys: number("keys"),
    adr: number("adr"),
    occupancy: number("occupancy"),
    equityCash: number("equityCash"),
    nearHaram: from.nearHaram === true,
    hasPermit: from.hasPermit === true,
    hasFeasibility: from.hasFeasibility === true,
    existingLien: from.existingLien === true,
  };
}
