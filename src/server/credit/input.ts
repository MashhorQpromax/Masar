import { z } from "zod";
import type { CreditReport, ParsedReport, ParseWarning } from "@/domain/credit";

/** A number here is always finite: the schema refuses NaN and Infinity by itself. */
const MAX_AMOUNT = 10_000_000_000;
const amount = z.number().min(0).max(MAX_AMOUNT);
const day = z.string().regex(/^\d{4}\/\d{2}\/\d{2}$/);
const age = z.number().int().min(0).max(30_000);
/** A name or a state read from the report. An over-long one is cut, not refused: extraction sometimes glues a whole line together. */
const name = (max: number) => z.string().transform((text) => text.trim().slice(0, max));
const optional = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

const facilitySchema = z.object({
  lender: name(300).pipe(z.string().min(1)),
  creditorType: z.enum(["bank", "finance_company", "telecom", "other"]),
  product: name(120),
  status: z.enum(["current", "late", "default", "settled", "closed"]),
  limit: optional(amount),
  balance: optional(amount),
  installment: optional(amount),
  overdue: optional(amount),
  openedAt: optional(day),
  endAt: optional(day),
  lastUpdate: optional(day),
  lastPayDate: optional(day),
  worstDelay: optional(z.number().int().min(0).max(3650)),
  lastDelayMonthsAgo: optional(age),
  defaultAmount: optional(amount),
  defaultNow: optional(amount),
  defaultListedAt: optional(day),
  defaultState: optional(name(120)),
  defaultMonthsAgo: optional(age),
  settledMonthsAgo: optional(age),
});

const judgmentSchema = z.object({
  kind: z.enum(["judgment", "enforcement", "bounced_cheque"]),
  active: z.boolean(),
  amount: optional(amount),
  remaining: optional(amount),
  creditor: optional(name(300)),
  date: optional(day),
  state: optional(name(120)),
  decisionNo: optional(name(40)),
  monthsAgo: optional(age),
});

/**
 * The amount asked for in an inquiry is only shown, never counted. Extraction often glues it to the
 * number beside it, so one no application could carry is left blank instead of refusing the whole report.
 */
const askedAmount = z
  .number()
  .nullable()
  .transform((value) => (value != null && value >= 0 && value <= MAX_AMOUNT ? value : null));
const inquirySchema = z.object({ date: day, lender: name(300), product: name(120), amount: askedAmount });

const summarySchema = z.object({
  activeCount: z.number().optional(),
  totalLimits: z.number().optional(),
  totalOutstanding: z.number().optional(),
  defaultedCount: z.number().optional(),
  defaultedRemaining: z.number().optional(),
  firstProductDate: day.optional(),
});

/** A credit record as it is stored and graded. A real report holds a few dozen lines at most. */
export const creditReportSchema = z.object({
  reportDate: optional(day),
  reportMonthsAgo: optional(age),
  score: optional(z.number().int().min(0).max(1000)),
  facilities: z.array(facilitySchema).max(200),
  judgments: z.array(judgmentSchema).max(100),
  serviceSuspension: z.boolean(),
  suspensionAssumed: z.boolean().optional(),
  travelBan: z.boolean().optional(),
  inquiries6m: optional(z.number().int().min(0).max(500)),
  inquiries12m: optional(z.number().int().min(0).max(500)),
  inquiries: z.array(inquirySchema).max(500).optional(),
  summary: summarySchema.optional(),
  notes: optional(z.string().max(4000)),
});

const count = z.number().int().min(0).max(100_000);
const warningSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("UNMATCHED_DEFAULT"), params: z.object({ amount }) }),
  z.object({ code: z.literal("ACTIVE_COUNT_MISMATCH"), params: z.object({ summary: count, read: count }) }),
  z.object({ code: z.literal("NO_FACILITIES"), params: z.object({}) }),
  z.object({ code: z.literal("SUSPENSION_ASSUMED"), params: z.object({ orders: count }) }),
  z.object({ code: z.literal("DEFAULTS_TOTAL_MISMATCH"), params: z.object({ read: z.number(), summary: z.number() }) }),
]);

const confidenceSchema = z.enum(["high", "medium", "low"]);

/** What the reader hands over: the record, what to double check, and how sure the reading is. */
export const readingSchema = z.object({
  report: creditReportSchema,
  warnings: z.array(warningSchema).max(300),
  confidence: confidenceSchema,
});

export type Reading = Pick<ParsedReport, "warnings" | "confidence"> & { report: CreditReport };

export function parseReading(value: unknown): Reading {
  return readingSchema.parse(value) as Reading;
}

/**
 * A stored record carries the reading's warnings and confidence beside the report's own fields.
 * A warning in a form this version does not know is left out rather than refused.
 */
const storedSchema = creditReportSchema.extend({
  warnings: z.array(z.unknown()).max(300).optional(),
  confidence: confidenceSchema.nullable().optional(),
});

export interface StoredCredit {
  report: CreditReport;
  warnings: ParseWarning[];
  confidence: ParsedReport["confidence"] | null;
}

export function parseStored(value: unknown): StoredCredit {
  const { warnings, confidence, ...report } = storedSchema.parse(value);
  return {
    report: report as CreditReport,
    warnings: (warnings ?? []).flatMap((entry) => {
      const known = warningSchema.safeParse(entry);
      return known.success ? [known.data as ParseWarning] : [];
    }),
    confidence: confidence ?? null,
  };
}

/** What a person found in Absher or Najiz. A null answer leaves that fact as the record has it, and a blank note removes the note. */
export const reviewSchema = z.object({
  suspension: z.boolean().nullable(),
  travelBan: z.boolean().nullable(),
  note: z.string().trim().max(4000).nullable(),
});

export type Review = z.infer<typeof reviewSchema>;
