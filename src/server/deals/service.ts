import "server-only";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { ZodError } from "zod";
import { dealStudy, stagesFor, type CreditFlags, type DealInput, type DealStudy, type Stage } from "@/domain/deal";
import type { Db, Tx } from "../db/client";
import { clients, dealItems, dealStageEvents, deals, notes, shareLinks } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { parseDealInput } from "./input";
import { borrowerOf, dealColumnsOf, dealInputOf, itemRowsOf, type ClientRow, type DealRow } from "./mapping";

const ENDED: Stage[] = ["closed", "lost"];

async function clientById(tx: Tx, clientId: number): Promise<ClientRow> {
  const [client] = await tx.select().from(clients).where(eq(clients.id, clientId));
  if (!client) throw new DomainError("NOT_FOUND", `client ${clientId}`);
  return client;
}

async function openDealOf(tx: Tx, clientId: number): Promise<DealRow | undefined> {
  const [deal] = await tx
    .select()
    .from(deals)
    .where(and(eq(deals.clientId, clientId), notInArray(deals.stage, ENDED)));
  return deal;
}

async function latestDealOf(tx: Tx, clientId: number): Promise<DealRow | undefined> {
  const [deal] = await tx.select().from(deals).where(eq(deals.clientId, clientId)).orderBy(desc(deals.id)).limit(1);
  return deal;
}

function validated(input: unknown): DealInput {
  try {
    return parseDealInput(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new DomainError("INVALID_INPUT", error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    throw error;
  }
}

/**
 * Saves the deal study of a client. Updates the client's deal in progress, or starts a new one.
 * The engine's result is stored with the deal so lists never have to recompute it.
 */
export async function saveDeal(
  db: Db,
  args: { clientId: number; input: unknown; actor: Actor; now?: Date },
): Promise<{ dealId: number; study: DealStudy }> {
  const input = validated(args.input);
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const client = await clientById(tx, args.clientId);
    const study = dealStudy(input, borrowerOf(client, now));
    const columns = {
      ...dealColumnsOf(input),
      capital: study.capital,
      fee: study.fee,
      clientNet: study.clientNet,
      verdict: study.verdict,
      computedAt: now,
      updatedAt: now,
    };

    const open = await openDealOf(tx, args.clientId);
    let dealId: number;
    if (open) {
      dealId = open.id;
      await tx.update(deals).set(columns).where(eq(deals.id, dealId));
      await tx.delete(dealItems).where(eq(dealItems.dealId, dealId));
    } else {
      const [created] = await tx
        .insert(deals)
        .values({ clientId: args.clientId, ownerId: args.actor.userId, ...columns })
        .returning({ id: deals.id });
      dealId = created!.id;
      await tx.insert(dealStageEvents).values({ dealId, stage: "study", userId: args.actor.userId, createdAt: now });
    }
    if (input.items.length) await tx.insert(dealItems).values(itemRowsOf(dealId, input.items));

    // The valuation entered in the deal is the client's latest known property value.
    if (input.propertyValue && input.propertyValue !== client.propertyValue) {
      await tx.update(clients).set({ propertyValue: input.propertyValue, updatedAt: now }).where(eq(clients.id, client.id));
    }
    await audit(tx, args.actor, "deal.save", "deal", dealId, {
      clientId: client.id,
      capital: study.capital,
      fee: study.fee,
      clientNet: study.clientNet,
      verdict: study.verdict,
    });
    return { dealId, study };
  });
}

/** Moves a deal to another stage of its structure and records when. Rejection goes through `rejectDeal`. */
export async function setDealStage(
  db: Db,
  args: { dealId: number; stage: Stage; note?: string | null; actor: Actor; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const [deal] = await tx.select().from(deals).where(eq(deals.id, args.dealId));
    if (!deal) throw new DomainError("NOT_FOUND", `deal ${args.dealId}`);
    const allowed = stagesFor(deal.structure).map((s) => s.stage);
    if (args.stage === "lost" || !allowed.includes(args.stage)) throw new DomainError("INVALID_STAGE", args.stage);
    if (deal.stage === args.stage) return;
    if (ENDED.includes(deal.stage) && !ENDED.includes(args.stage)) {
      const other = await openDealOf(tx, deal.clientId);
      if (other) throw new DomainError("DEAL_ALREADY_OPEN", `client ${deal.clientId}`);
    }
    await tx.update(deals).set({ stage: args.stage, updatedAt: now }).where(eq(deals.id, deal.id));
    await tx
      .insert(dealStageEvents)
      .values({ dealId: deal.id, stage: args.stage, note: args.note ?? null, userId: args.actor.userId, createdAt: now });
    await audit(tx, args.actor, "deal.stage", "deal", deal.id, { from: deal.stage, to: args.stage, note: args.note ?? null });
  });
}

/**
 * Rejects a client's file because the deal does not close. The deal is marked lost, the client is marked
 * rejected, and every link shared with the client stops working, so no message reaches a rejected client.
 */
export async function rejectDeal(
  db: Db,
  args: { clientId: number; reason: string; actor: Actor; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const client = await clientById(tx, args.clientId);
    const deal = await openDealOf(tx, client.id);
    if (deal) {
      await tx.update(deals).set({ stage: "lost", updatedAt: now }).where(eq(deals.id, deal.id));
      await tx
        .insert(dealStageEvents)
        .values({ dealId: deal.id, stage: "lost", note: args.reason, userId: args.actor.userId, createdAt: now });
    }
    await tx.update(clients).set({ status: "rejected", nextStep: null, nextStepDue: null, updatedAt: now }).where(eq(clients.id, client.id));
    await tx.update(shareLinks).set({ revoked: true }).where(and(eq(shareLinks.clientId, client.id), eq(shareLinks.revoked, false)));
    await tx.insert(notes).values({ clientId: client.id, kind: "status", body: args.reason, userId: args.actor.userId, createdAt: now });
    await audit(tx, args.actor, "client.reject", "client", client.id, { from: client.status, reason: args.reason, dealId: deal?.id ?? null });
  });
}

/** Puts a rejected file back under study. */
export async function reopenDeal(
  db: Db,
  args: { clientId: number; note: string; actor: Actor; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const client = await clientById(tx, args.clientId);
    const open = await openDealOf(tx, client.id);
    const last = open ? undefined : await latestDealOf(tx, client.id);
    if (last && last.stage === "lost") {
      await tx.update(deals).set({ stage: "study", updatedAt: now }).where(eq(deals.id, last.id));
      await tx
        .insert(dealStageEvents)
        .values({ dealId: last.id, stage: "study", note: args.note, userId: args.actor.userId, createdAt: now });
    }
    await tx.update(clients).set({ status: "study", updatedAt: now }).where(eq(clients.id, client.id));
    await tx.insert(notes).values({ clientId: client.id, kind: "status", body: args.note, userId: args.actor.userId, createdAt: now });
    await audit(tx, args.actor, "client.reopen", "client", client.id, { from: client.status });
  });
}

export interface DealView {
  deal: DealRow;
  client: ClientRow;
  input: DealInput;
  study: DealStudy;
  /** When the deal entered its current stage. */
  stageEnteredAt: Date;
}

/** A deal with its study recomputed from what is stored. */
export async function getDeal(
  db: Db,
  args: { dealId: number; credit?: CreditFlags | null; now?: Date },
): Promise<DealView | null> {
  const now = args.now ?? new Date();
  const [deal] = await db.select().from(deals).where(eq(deals.id, args.dealId));
  if (!deal) return null;
  const client = await clientById(db, deal.clientId);
  const items = await db.select().from(dealItems).where(eq(dealItems.dealId, deal.id));
  const [event] = await db
    .select({ at: dealStageEvents.createdAt })
    .from(dealStageEvents)
    .where(and(eq(dealStageEvents.dealId, deal.id), eq(dealStageEvents.stage, deal.stage)))
    .orderBy(desc(dealStageEvents.id))
    .limit(1);
  const input = dealInputOf(deal, items);
  return {
    deal,
    client,
    input,
    study: dealStudy(input, borrowerOf(client, now), args.credit),
    stageEnteredAt: event?.at ?? deal.updatedAt,
  };
}

export interface OpenDeal {
  dealId: number;
  clientId: number;
  fileNo: string;
  clientName: string;
  stage: Stage;
  structure: DealRow["structure"];
  capital: number | null;
  fee: number | null;
  clientNet: number | null;
  verdict: DealRow["verdict"];
  stageEnteredAt: Date;
}

/** Every deal in progress, for the home map. */
export async function listOpenDeals(db: Db): Promise<OpenDeal[]> {
  const rows = await db
    .select({
      dealId: deals.id,
      clientId: clients.id,
      fileNo: clients.fileNo,
      clientName: clients.fullName,
      stage: deals.stage,
      structure: deals.structure,
      capital: deals.capital,
      fee: deals.fee,
      clientNet: deals.clientNet,
      verdict: deals.verdict,
      updatedAt: deals.updatedAt,
    })
    .from(deals)
    .innerJoin(clients, eq(clients.id, deals.clientId))
    .where(notInArray(deals.stage, ENDED))
    .orderBy(desc(deals.updatedAt));
  if (!rows.length) return [];
  const events = await db
    .select({ dealId: dealStageEvents.dealId, stage: dealStageEvents.stage, at: dealStageEvents.createdAt })
    .from(dealStageEvents)
    .orderBy(dealStageEvents.id);
  const entered = new Map<string, Date>();
  for (const e of events) entered.set(`${e.dealId}:${e.stage}`, e.at);
  return rows.map(({ updatedAt, ...row }) => ({ ...row, stageEnteredAt: entered.get(`${row.dealId}:${row.stage}`) ?? updatedAt }));
}
