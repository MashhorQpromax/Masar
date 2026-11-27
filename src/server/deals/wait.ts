import "server-only";
import { and, inArray } from "drizzle-orm";
import { dealWait, holdOf, holdsOf, paysDefault, waitMonths, type DealWait, type Hold, type HoldTerm } from "@/domain/deal";
import type { Db, Tx } from "../db/client";
import { dealItems } from "../db/schema";
import { listProducts } from "../lenders/service";
import type { DealView, OpenDeal } from "./service";

/**
 * The wait of a deal already read: what its lenders, as the catalogue has them today, say of a client
 * whose default was paid. Null for a deal that pays none. `products` saves reading the catalogue twice.
 */
export async function waitOf(db: Tx, view: Pick<DealView, "input" | "study">, now: Date, products?: readonly HoldTerm[]): Promise<DealWait | null> {
  if (!paysDefault(view.input)) return null;
  return dealWait(view.input, view.study, holdsOf(view.input, products ?? (await listProducts(db, { now }))));
}

/** The hold of every deal in progress that pays a default, by deal, for the home map. */
export async function holdsByDeal(db: Db, open: readonly OpenDeal[], now: Date): Promise<Map<number, Hold>> {
  const holds = new Map<number, Hold>();
  if (!open.length) return holds;
  const rows = await db
    .select({ dealId: dealItems.dealId, kind: dealItems.kind, by: dealItems.paidBy })
    .from(dealItems)
    .where(
      and(
        inArray(
          dealItems.dealId,
          open.map((deal) => deal.dealId),
        ),
        inArray(dealItems.kind, ["execution", "default"]),
      ),
    );
  const paying = open.filter((deal) => paysDefault({ items: rows.filter((row) => row.dealId === deal.dealId), structure: deal.structure }));
  if (!paying.length) return holds;
  const products = await listProducts(db, { now });
  for (const deal of paying) {
    const items = rows.filter((row) => row.dealId === deal.dealId);
    const hold = holdOf(waitMonths({ items, structure: deal.structure }, holdsOf(deal, products)), deal.paidAt);
    if (hold) holds.set(deal.dealId, hold);
  }
  return holds;
}
