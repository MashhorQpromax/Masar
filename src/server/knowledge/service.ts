import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { ZodError, type ZodType } from "zod";
import { STRUCTURES, structureOf, type DealStudy } from "@/domain/deal";
import { INBOX_PAPER } from "@/domain/documents";
import { dayOf, FINANCE_TYPES, type FinanceType } from "@/domain/eligibility";
import type { FundingRoute } from "@/domain/funding";
import { DECISIONS, RULE_KINDS, type Decision, type DecisionFact, type Rule, type RuleKind } from "@/domain/knowledge";
import type { LenderReply } from "@/domain/opportunity";
import type { Db, Tx } from "../db/client";
import { documentFiles, documents, lenderRules, lenders, outcomes, users } from "../db/schema";
import { borrowerOf } from "../deals/mapping";
import { amendDeal } from "../deals/service";
import { fundingIn } from "../funding/service";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { decisionSchema, ruleSchema } from "./input";

function parsed<T>(schema: ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) throw new DomainError("INVALID_INPUT", error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    throw error;
  }
}

const kindOf = (value: string | null): FinanceType | null => ((FINANCE_TYPES as readonly string[]).includes(value ?? "") ? (value as FinanceType) : null);

/**
 * Everything the office wrote down about lenders: what holds for every lender first, then lender by
 * lender, the newest first. A rule about a lender that left the catalogue is not shown.
 */
export async function listRules(db: Tx): Promise<Rule[]> {
  const rows = await db
    .select({ rule: lenderRules, lenderName: lenders.name, lenderActive: lenders.active, author: users.name })
    .from(lenderRules)
    .leftJoin(lenders, eq(lenders.id, lenderRules.lenderId))
    .leftJoin(users, eq(users.id, lenderRules.userId))
    .where(eq(lenderRules.active, true))
    .orderBy(sql`${lenderRules.lenderId} is not null`, asc(lenderRules.lenderId), desc(lenderRules.id));
  return rows
    .filter((row) => row.rule.lenderId == null || row.lenderActive === true)
    .filter((row) => (RULE_KINDS as readonly string[]).includes(row.rule.kind))
    .map(({ rule, lenderName, author }) => ({
      id: rule.id,
      lenderId: rule.lenderId,
      lenderName: rule.lenderId == null ? null : lenderName,
      financeType: kindOf(rule.financeType),
      kind: rule.kind as RuleKind,
      title: rule.title,
      body: rule.body,
      author,
      createdAt: rule.createdAt,
    }));
}

/** The lenders a rule or a decision can name. */
export async function listLenders(db: Tx): Promise<{ id: number; name: string }[]> {
  return db.select({ id: lenders.id, name: lenders.name }).from(lenders).where(eq(lenders.active, true)).orderBy(lenders.id);
}

async function activeLender(tx: Tx, lenderId: number): Promise<{ id: number; name: string }> {
  const [lender] = await tx.select({ id: lenders.id, name: lenders.name }).from(lenders).where(and(eq(lenders.id, lenderId), eq(lenders.active, true)));
  if (!lender) throw new DomainError("NOT_FOUND", `lender ${lenderId}`);
  return lender;
}

/** Writes down something learned about a lender, or about every lender. */
export async function addRule(db: Db, args: { rule: unknown; actor: Actor; now?: Date }): Promise<{ id: number }> {
  const rule = parsed(ruleSchema, args.rule);
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const lender = rule.lenderId == null ? null : await activeLender(tx, rule.lenderId);
    const [row] = await tx
      .insert(lenderRules)
      .values({ lenderId: lender?.id ?? null, financeType: rule.financeType, kind: rule.kind, title: rule.title, body: rule.body, userId: args.actor.userId, createdAt: now })
      .returning({ id: lenderRules.id });
    await audit(tx, args.actor, "lender.rule_add", "rule", row!.id, { title: rule.title, kind: rule.kind, lender: lender?.name ?? null });
    return { id: row!.id };
  });
}

/** Takes a rule out of what the screens show. It stays stored, with who removed it in the log. */
export async function archiveRule(db: Db, args: { ruleId: number; actor: Actor }): Promise<void> {
  await db.transaction(async (tx) => {
    const [rule] = await tx.select().from(lenderRules).where(eq(lenderRules.id, args.ruleId));
    if (!rule || !rule.active) throw new DomainError("NOT_FOUND", `rule ${args.ruleId}`);
    await tx.update(lenderRules).set({ active: false }).where(eq(lenderRules.id, rule.id));
    await audit(tx, args.actor, "lender.rule_archive", "rule", rule.id, { title: rule.title });
  });
}

type Part = "mortgage" | "personal";

/** What the engine expected one lender to give for one part of the deal: the most among its routes. */
function estimateFor(routes: FundingRoute[], lenderId: number, part: Part): number | null {
  const amounts = routes.flatMap((route) => {
    const leg = route[part];
    return leg && leg.product.lenderId === String(lenderId) ? [leg.amount] : [];
  });
  return amounts.length ? Math.max(...amounts) : null;
}

/**
 * Records what a lender answered for a deal's client. The facts about the client and what the engine
 * expected are read here, from the file as it stands, never from what a screen sent. An approved
 * amount can become the deal's own figure for that part in the same step.
 */
export async function recordDecision(db: Db, args: { dealId: number; decision: unknown; actor: Actor; now?: Date }): Promise<{ id: number; study: DealStudy | null }> {
  const input = parsed(decisionSchema, args.decision);
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const view = await fundingIn(tx, { dealId: args.dealId, now });
    if (!view) throw new DomainError("NOT_FOUND", `deal ${args.dealId}`);
    if (!STRUCTURES[structureOf(view.input)][input.part]) throw new DomainError("INVALID_INPUT", `part: the deal has no ${input.part}`);
    const lender = await activeLender(tx, input.lenderId);
    const { client, study } = view;
    if (input.replyPaperId != null && !(await replyPapers(tx, client.id)).some((paper) => paper.id === input.replyPaperId)) {
      throw new DomainError("REPLY_PAPER", `paper ${input.replyPaperId}`);
    }
    const [row] = await tx
      .insert(outcomes)
      .values({
        clientId: client.id,
        lenderId: lender.id,
        financeType: input.part,
        sector: client.sector,
        salary: client.totalSalary ?? client.basicSalary,
        age: borrowerOf(client, now).age,
        simah: view.standing ?? "unknown",
        decision: input.decision,
        requestedAmount: study.financing[input.part] || null,
        estimatedAmount: estimateFor(view.routes, lender.id, input.part),
        approvedAmount: input.approvedAmount,
        conditions: input.asks,
        reason: input.reason,
        note: input.note,
        replyPaperId: input.replyPaperId,
        userId: args.actor.userId,
        createdAt: now,
      })
      .returning({ id: outcomes.id });
    // The amount a lender approved is an offer: the deal is computed on it from now on.
    const amended =
      input.onDeal && input.approvedAmount != null
        ? await amendDeal(tx, { dealId: args.dealId, terms: input.part === "mortgage" ? { bankMortgage: input.approvedAmount } : { bankPersonal: input.approvedAmount }, actor: args.actor, now })
        : null;
    await audit(tx, args.actor, "lender.decision", "client", client.id, { lender: lender.name, part: input.part, decision: input.decision, onDeal: amended != null, written: input.replyPaperId != null });
    return { id: row!.id, study: amended?.study ?? null };
  });
}

/**
 * The papers of a client's file that can hold a lender's written answer: each has a file, and nobody
 * sent it back. What waits unsorted in the WhatsApp tray is not one yet.
 */
export async function replyPapers(db: Tx, clientId: number): Promise<{ id: number; code: string; label: string | null }[]> {
  return db
    .select({ id: documents.id, code: documents.code, label: documents.label })
    .from(documents)
    .where(
      and(
        eq(documents.clientId, clientId),
        inArray(documents.status, ["received", "verified"]),
        ne(documents.code, INBOX_PAPER),
        sql`exists (select 1 from ${documentFiles} where ${documentFiles.docId} = ${documents.id})`,
      ),
    )
    .orderBy(desc(documents.updatedAt), desc(documents.id));
}

/**
 * What lenders answered about a client, newest first, as the opportunities read them. An answer is
 * written while the paper it points to still holds a file and was not sent back.
 */
export async function lenderReplies(db: Tx, clientId: number): Promise<LenderReply[]> {
  const rows = await db
    .select({ lenderId: outcomes.lenderId, part: outcomes.financeType, decision: outcomes.decision, amount: outcomes.approvedAmount, at: outcomes.createdAt, paper: outcomes.replyPaperId })
    .from(outcomes)
    .where(eq(outcomes.clientId, clientId))
    .orderBy(desc(outcomes.createdAt), desc(outcomes.id));
  const papers = new Set((await replyPapers(db, clientId)).map((paper) => paper.id));
  return rows.flatMap((row) =>
    (row.part === "mortgage" || row.part === "personal") && (DECISIONS as readonly string[]).includes(row.decision)
      ? [{ lenderId: String(row.lenderId), part: row.part, decision: row.decision, amount: row.amount, on: dayOf(row.at), written: row.paper != null && papers.has(row.paper) }]
      : [],
  );
}

/** A recorded decision as a person reads it. It names no client. */
export interface DecisionLine {
  id: number;
  lenderId: number;
  lenderName: string;
  financeType: FinanceType | null;
  sector: string;
  salary: number | null;
  decision: Decision;
  estimatedAmount: number | null;
  approvedAmount: number | null;
  asks: string[];
  reason: string | null;
  note: string | null;
  /** A paper in the file holds the answer in writing. */
  written: boolean;
  createdAt: Date;
}

type OutcomeRow = typeof outcomes.$inferSelect;

const lineOf = (row: OutcomeRow, lenderName: string): DecisionLine => ({
  id: row.id,
  lenderId: row.lenderId,
  lenderName,
  financeType: kindOf(row.financeType),
  sector: row.sector,
  salary: row.salary,
  decision: row.decision,
  estimatedAmount: row.estimatedAmount,
  approvedAmount: row.approvedAmount,
  asks: row.conditions,
  reason: row.reason,
  note: row.note,
  written: row.replyPaperId != null,
  createdAt: row.createdAt,
});

/** The decisions recorded last, the newest first. */
export async function recentDecisions(db: Tx, args: { limit?: number; clientId?: number } = {}): Promise<DecisionLine[]> {
  const rows = await db
    .select({ outcome: outcomes, lenderName: lenders.name })
    .from(outcomes)
    .innerJoin(lenders, eq(lenders.id, outcomes.lenderId))
    .where(args.clientId == null ? undefined : eq(outcomes.clientId, args.clientId))
    .orderBy(desc(outcomes.id))
    .limit(args.limit ?? 25);
  return rows.map(({ outcome, lenderName }) => lineOf(outcome, lenderName));
}

/** Every recorded decision in the order it was recorded, as the adding up reads it. */
export async function decisionFacts(db: Tx): Promise<DecisionFact[]> {
  const rows = await db
    .select({
      lenderId: outcomes.lenderId,
      financeType: outcomes.financeType,
      sector: outcomes.sector,
      salary: outcomes.salary,
      decision: outcomes.decision,
      estimatedAmount: outcomes.estimatedAmount,
      approvedAmount: outcomes.approvedAmount,
      conditions: outcomes.conditions,
      reason: outcomes.reason,
    })
    .from(outcomes)
    .innerJoin(lenders, and(eq(lenders.id, outcomes.lenderId), eq(lenders.active, true)))
    .orderBy(asc(outcomes.id));
  return rows.filter((row) => (DECISIONS as readonly string[]).includes(row.decision));
}

/** Everything the knowledge page shows. */
export interface KnowledgeView {
  rules: Rule[];
  facts: DecisionFact[];
  recent: DecisionLine[];
  lenders: { id: number; name: string }[];
}

export async function getKnowledge(db: Db): Promise<KnowledgeView> {
  return { rules: await listRules(db), facts: await decisionFacts(db), recent: await recentDecisions(db, { limit: 12 }), lenders: await listLenders(db) };
}
