import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { ASKED_KINDS, FINANCE_TYPES, type Answer, type AskedKind, type FinanceType, type Unmet } from "@/domain/eligibility";
import type { Db, Tx } from "../db/client";
import { clients, conditionAnswers, lenders, productConditions, products, users } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";

const isAnswer = (value: string): value is Answer => value === "met" || value === "unmet";

/**
 * What people answered for a client about lenders' special conditions, by the condition's id. Only
 * conditions that still stand are read: an answer to one that was taken off answers nothing.
 */
export async function answersOf(db: Tx, clientId: number): Promise<Record<string, Answer>> {
  const rows = await db
    .select({ conditionId: conditionAnswers.conditionId, answer: conditionAnswers.answer })
    .from(conditionAnswers)
    .innerJoin(productConditions, eq(productConditions.id, conditionAnswers.conditionId))
    .where(and(eq(conditionAnswers.clientId, clientId), eq(productConditions.active, true)));
  const answers: Record<string, Answer> = {};
  for (const row of rows) if (isAnswer(row.answer)) answers[String(row.conditionId)] = row.answer;
  return answers;
}

/** One question a lender asks about a client, with what was answered for this one. */
export interface AskedCondition {
  id: number;
  kind: AskedKind;
  text: string | null;
  unmet: Unmet;
  /** Null until somebody answers. */
  answer: Answer | null;
  answeredAt: Date | null;
  /** Who answered, when the account still exists. */
  answeredBy: string | null;
}

/** A lender's questions about a client, product by product. */
export interface AskedLender {
  id: number;
  name: string;
  products: { id: number; name: string; financeType: FinanceType; conditions: AskedCondition[] }[];
}

/** Everything the page of a client's answers shows. */
export interface AskedView {
  client: { id: number; fullName: string; fileNo: string };
  lenders: AskedLender[];
  /** How many questions nobody has answered for this client. */
  open: number;
}

/**
 * Every question the lenders in use ask about a client, with what was answered for this one. Only
 * running products of the lenders in the catalogue are read: nobody is sent to the others.
 */
export async function getAsked(db: Db, args: { clientId: number }): Promise<AskedView | null> {
  const [client] = await db.select({ id: clients.id, fullName: clients.fullName, fileNo: clients.fileNo }).from(clients).where(eq(clients.id, args.clientId));
  if (!client) return null;
  const rows = await db
    .select({ condition: productConditions, product: products, lender: lenders })
    .from(productConditions)
    .innerJoin(products, eq(products.id, productConditions.productId))
    .innerJoin(lenders, eq(lenders.id, products.lenderId))
    .where(and(eq(productConditions.active, true), eq(products.active, true), eq(lenders.active, true), inArray(productConditions.kind, [...ASKED_KINDS])))
    .orderBy(asc(lenders.id), asc(products.id), asc(productConditions.id));
  const given = await db
    .select({ answer: conditionAnswers, by: users.name })
    .from(conditionAnswers)
    .leftJoin(users, eq(users.id, conditionAnswers.userId))
    .where(eq(conditionAnswers.clientId, client.id));
  const answerOf = new Map(given.map((row) => [row.answer.conditionId, row]));

  const byLender = new Map<number, AskedLender>();
  let open = 0;
  for (const { condition, product, lender } of rows) {
    if (!(FINANCE_TYPES as readonly string[]).includes(product.financeType)) continue;
    const entry = byLender.get(lender.id) ?? { id: lender.id, name: lender.name, products: [] };
    byLender.set(lender.id, entry);
    let line = entry.products.find((p) => p.id === product.id);
    if (!line) entry.products.push((line = { id: product.id, name: product.name, financeType: product.financeType as FinanceType, conditions: [] }));
    const said = answerOf.get(condition.id);
    const answer = said && isAnswer(said.answer.answer) ? said.answer.answer : null;
    if (!answer) open += 1;
    line.conditions.push({
      id: condition.id,
      kind: condition.kind as AskedKind,
      text: condition.text,
      unmet: condition.unmet === "action" ? "action" : "block",
      answer,
      answeredAt: answer ? said!.answer.answeredAt : null,
      answeredBy: answer ? (said!.by ?? null) : null,
    });
  }
  return { client, lenders: [...byLender.values()], open };
}

/**
 * Records what a person answered about a client and one of a lender's special conditions, or takes
 * the answer back (`answer` null). Only a condition that stands and that a person answers can be
 * answered: what the engine measures is never answered by hand.
 */
export async function answerCondition(db: Db, args: { clientId: number; conditionId: number; answer: Answer | null; actor: Actor; now?: Date }): Promise<void> {
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, args.clientId));
    if (!client) throw new DomainError("NOT_FOUND", `client ${args.clientId}`);
    const [found] = await tx
      .select({ condition: productConditions, product: products, lender: lenders })
      .from(productConditions)
      .innerJoin(products, eq(products.id, productConditions.productId))
      .innerJoin(lenders, eq(lenders.id, products.lenderId))
      .where(eq(productConditions.id, args.conditionId));
    if (!found || !found.condition.active) throw new DomainError("NOT_FOUND", `condition ${args.conditionId}`);
    if (!(ASKED_KINDS as readonly string[]).includes(found.condition.kind)) throw new DomainError("INVALID_INPUT", `condition ${args.conditionId} is measured`);
    const [before] = await tx
      .select()
      .from(conditionAnswers)
      .where(and(eq(conditionAnswers.conditionId, found.condition.id), eq(conditionAnswers.clientId, client.id)));
    if ((before?.answer ?? null) === args.answer) return;
    if (before) await tx.delete(conditionAnswers).where(eq(conditionAnswers.id, before.id));
    if (args.answer) await tx.insert(conditionAnswers).values({ conditionId: found.condition.id, clientId: client.id, answer: args.answer, userId: args.actor.userId, answeredAt: now });
    await audit(tx, args.actor, "client.condition_answer", "client", client.id, {
      lender: found.lender.name,
      product: found.product.name,
      condition: found.condition.id,
      kind: found.condition.kind,
      answer: args.answer,
      before: before?.answer ?? null,
    });
  });
}
