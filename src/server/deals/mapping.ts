import { borrowerIn, type Borrower, type DealInput, type DealItem } from "@/domain/deal";
import type { ClientRow } from "../clients/service";
import type { dealItems, deals } from "../db/schema";

export type { ClientRow };
export type DealRow = typeof deals.$inferSelect;
export type DealItemRow = typeof dealItems.$inferSelect;

/** The engine's input, rebuilt from a stored deal and its items. */
export function dealInputOf(deal: DealRow, items: DealItemRow[]): DealInput {
  return {
    structure: deal.structure,
    items: [...items]
      .sort((a, b) => a.position - b.position)
      .map((i): DealItem => ({
        id: i.key,
        kind: i.kind,
        label: i.label,
        original: i.original,
        pay: i.pay,
        by: i.paidBy,
        ...(i.confirmed != null ? { confirmed: i.confirmed } : {}),
        monthly: i.monthly,
      })),
    propertyValue: deal.propertyValue,
    transferTaxPct: deal.transferTaxPct,
    saleTaxPct: deal.saleTaxPct,
    fixedCosts: deal.fixedCosts,
    fee: {
      settlePct: deal.feeSettlePct,
      settleIncludesPayoff: deal.feeSettleIncludesPayoff,
      financePct: deal.feeFinancePct,
      financeBase: deal.feeFinanceBase,
      fixed: deal.feeFixed,
    },
    targetBank: deal.targetBank,
    mortgageApr: deal.mortgageApr,
    personalFlat: deal.personalFlat,
    personalMonths: deal.personalMonths,
    mortgageMaxAge: deal.mortgageMaxAge,
    mortgageMaxMonths: deal.mortgageMaxMonths,
    ltvPct: deal.ltvPct,
    bankMortgage: deal.bankMortgage,
    bankPersonal: deal.bankPersonal,
    mortgageCeiling: deal.mortgageCeiling,
    personalCeiling: deal.personalCeiling,
    personalLender: deal.personalLender,
    personalLenderKind: deal.personalLenderKind,
    notes: deal.notes,
  };
}

/** Deal columns for an engine input. */
export function dealColumnsOf(input: DealInput) {
  return {
    structure: input.structure ?? "settle_refi_personal",
    propertyValue: input.propertyValue,
    transferTaxPct: input.transferTaxPct,
    saleTaxPct: input.saleTaxPct,
    fixedCosts: input.fixedCosts,
    feeSettlePct: input.fee.settlePct,
    feeSettleIncludesPayoff: input.fee.settleIncludesPayoff,
    feeFinancePct: input.fee.financePct,
    feeFinanceBase: input.fee.financeBase,
    feeFixed: input.fee.fixed,
    targetBank: input.targetBank,
    mortgageApr: input.mortgageApr,
    personalFlat: input.personalFlat,
    personalMonths: input.personalMonths,
    mortgageMaxAge: input.mortgageMaxAge,
    mortgageMaxMonths: input.mortgageMaxMonths,
    ltvPct: input.ltvPct,
    bankMortgage: input.bankMortgage,
    bankPersonal: input.bankPersonal,
    mortgageCeiling: input.mortgageCeiling ?? null,
    personalCeiling: input.personalCeiling ?? null,
    personalLender: input.personalLender ?? null,
    personalLenderKind: input.personalLenderKind ?? null,
    notes: input.notes,
  } satisfies Partial<typeof deals.$inferInsert>;
}

export function itemRowsOf(dealId: number, items: DealItem[]): (typeof dealItems.$inferInsert)[] {
  return items.map((i, position) => ({
    dealId,
    key: i.id,
    position,
    kind: i.kind,
    label: i.label,
    original: i.original,
    pay: i.pay,
    paidBy: i.by,
    confirmed: i.confirmed ?? null,
    monthly: i.monthly ?? null,
  }));
}

/** The borrower facts the engine needs, as of `now`. */
export function borrowerOf(client: ClientRow, now: Date): Borrower {
  return borrowerIn(client, now.getFullYear());
}
