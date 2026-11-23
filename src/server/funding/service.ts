import "server-only";
import { eq } from "drizzle-orm";
import type { Standing } from "@/domain/credit";
import type { DealInput, DealStudy, Stage } from "@/domain/deal";
import type { Nationality } from "@/domain/eligibility";
import { fundingRoutes, knownRecord, recordAfterSettlement, type FundingRoute, type RecordAfter } from "@/domain/funding";
import type { Db, Tx } from "../db/client";
import { clients, lenders } from "../db/schema";
import { amendDeal, getDeal } from "../deals/service";
import { borrowerOf, type ClientRow, type DealRow } from "../deals/mapping";
import { listProducts } from "../lenders/service";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";

const ENDED: Stage[] = ["closed", "lost"];

/** Everything the lenders page of a deal shows. */
export interface FundingView {
  deal: DealRow;
  client: ClientRow;
  input: DealInput;
  /** The deal as it stands, on the numbers it holds now. */
  study: DealStudy;
  /** What a lender will read on the credit record after the settlement. */
  record: RecordAfter;
  /** The credit record in one word, as it reads today. Null when no report was read. */
  standing: Standing | null;
  /** Every way the catalogue can fund the deal, best first. */
  routes: FundingRoute[];
  /** The route whose terms the deal holds now. Null when it holds none of them. */
  chosen: string | null;
  /** A lender's actual offer is recorded: its numbers stand and no route can replace them. */
  offerRecorded: boolean;
  ended: boolean;
  /** The banks a salary can be paid into, for saying which one the client's is. */
  banks: { code: string; name: string }[];
}

/** A route is the deal's own when the deal holds every term the route would write. */
function holds(input: DealInput, route: FundingRoute): boolean {
  return (Object.keys(route.terms) as (keyof FundingRoute["terms"])[]).every((key) => (input[key] ?? null) === (route.terms[key] ?? null));
}

/** The same view inside a transaction that is already open, for a change that has to read it first. */
export async function fundingIn(db: Tx, args: { dealId: number; now: Date }): Promise<FundingView | null> {
  const view = await getDeal(db as Db, args);
  if (!view) return null;
  const { deal, client, input } = view;
  const record = recordAfterSettlement(input, view.credit ? knownRecord(view.credit.report, view.credit.analysis) : null);
  const routes = fundingRoutes({
    input,
    borrower: borrowerOf(client, args.now),
    who: { nationality: (client.nationality === "non_saudi" ? "non_saudi" : "saudi") satisfies Nationality, salaryBank: client.salaryBank, record },
    products: await listProducts(db),
    credit: view.creditFlags,
  });
  const banks = await db.select({ code: lenders.bankCode, name: lenders.name }).from(lenders).where(eq(lenders.active, true)).orderBy(lenders.id);
  return {
    deal,
    client,
    input,
    study: view.study,
    record,
    standing: view.credit?.analysis.standing ?? null,
    routes,
    chosen: routes.find((route) => holds(input, route))?.key ?? null,
    offerRecorded: input.bankMortgage != null || input.bankPersonal != null,
    ended: ENDED.includes(deal.stage),
    banks: banks.flatMap((bank) => (bank.code ? [{ code: bank.code, name: bank.name }] : [])),
  };
}

/** The lenders that could fund a deal, each run through the deal's own numbers. */
export async function getFunding(db: Db, args: { dealId: number; now?: Date }): Promise<FundingView | null> {
  return fundingIn(db, { dealId: args.dealId, now: args.now ?? new Date() });
}

/**
 * Puts a route's terms on the deal: its lenders, their rates, terms and ceilings. The routes are worked
 * out again here, so what is written is what the catalogue says now and not what a screen showed.
 */
export async function applyRoute(db: Db, args: { dealId: number; key: string; actor: Actor; now?: Date }): Promise<{ study: DealStudy }> {
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const view = await fundingIn(tx, { dealId: args.dealId, now });
    if (!view) throw new DomainError("NOT_FOUND", `deal ${args.dealId}`);
    if (view.ended) throw new DomainError("DEAL_ENDED", `deal ${args.dealId}`);
    // An offer is what a lender actually gave. An estimate from the catalogue never overwrites it.
    if (view.offerRecorded) throw new DomainError("OFFER_RECORDED", `deal ${args.dealId}`);
    const route = view.routes.find((r) => r.key === args.key);
    if (!route) throw new DomainError("ROUTE_GONE", args.key);
    if (route.status === "fail") throw new DomainError("ROUTE_REFUSED", args.key);
    const { study } = await amendDeal(tx, { dealId: args.dealId, terms: route.terms, actor: args.actor, now });
    await audit(tx, args.actor, "deal.route", "deal", args.dealId, {
      route: route.key,
      mortgage: route.mortgage ? { lender: route.mortgage.product.lenderName, product: route.mortgage.product.name, amount: route.mortgage.amount } : null,
      personal: route.personal ? { lender: route.personal.product.lenderName, product: route.personal.product.name, amount: route.personal.amount } : null,
      verified: route.verified,
    });
    return { study };
  });
}

/** Records which bank the client's salary is paid into. Lenders that want the salary moved depend on it. */
export async function setSalaryBank(db: Db, args: { clientId: number; bankCode: string | null; actor: Actor; now?: Date }): Promise<void> {
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const [client] = await tx.select({ id: clients.id, salaryBank: clients.salaryBank }).from(clients).where(eq(clients.id, args.clientId));
    if (!client) throw new DomainError("NOT_FOUND", `client ${args.clientId}`);
    if (args.bankCode != null) {
      const [bank] = await tx.select({ id: lenders.id }).from(lenders).where(eq(lenders.bankCode, args.bankCode));
      if (!bank) throw new DomainError("INVALID_INPUT", `bank ${args.bankCode}`);
    }
    if (client.salaryBank === args.bankCode) return;
    await tx.update(clients).set({ salaryBank: args.bankCode, updatedAt: now }).where(eq(clients.id, client.id));
    await audit(tx, args.actor, "client.update", "client", client.id, { changed: ["salaryBank"] });
  });
}
