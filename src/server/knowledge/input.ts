import { z } from "zod";
import { FINANCE_TYPES } from "@/domain/eligibility";
import { ASKS, DECISIONS, REFUSALS, RULE_KINDS } from "@/domain/knowledge";

const id = z.number().int().positive();
/** Text a person typed: trimmed, and empty is nothing. */
const said = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((text) => text || null);

/** Something a person writes down about a lender. */
export const ruleSchema = z.object({
  /** Null: it holds for every lender. */
  lenderId: id.nullable(),
  /** Null: it holds for every kind of finance. */
  financeType: z.enum(FINANCE_TYPES).nullable(),
  kind: z.enum(RULE_KINDS),
  title: z.string().trim().min(3).max(120),
  body: said(600),
});

export type RuleInput = z.infer<typeof ruleSchema>;

/** What a lender answered for a deal's client. */
export const decisionSchema = z
  .object({
    lenderId: id,
    /** The part of the new financing the lender answered about. */
    part: z.enum(["mortgage", "personal"]),
    decision: z.enum(DECISIONS),
    approvedAmount: z.number().positive().max(10_000_000_000).nullable(),
    asks: z.array(z.enum(ASKS)).max(ASKS.length),
    reason: z.enum(REFUSALS).nullable(),
    note: said(500),
    /** The approved amount becomes the deal's own figure for this part. */
    onDeal: z.boolean(),
    /** The paper in the client's file that holds the answer in writing. Null: it was said, not written. */
    replyPaperId: id.nullable().default(null),
  })
  .superRefine((value, context) => {
    // A yes says how much. A no says nothing about an amount.
    if (value.decision !== "rejected" && value.approvedAmount == null) context.addIssue({ code: "custom", path: ["approvedAmount"], message: "an approval carries an amount" });
  })
  .transform((value) => {
    const refused = value.decision === "rejected";
    return {
      ...value,
      asks: [...new Set(value.asks)],
      approvedAmount: refused ? null : value.approvedAmount,
      reason: refused ? value.reason : null,
      onDeal: refused ? false : value.onDeal,
    };
  });

export type DecisionInput = z.infer<typeof decisionSchema>;
