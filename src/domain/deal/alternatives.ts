import { adminFee, principalFrom } from "../finance/amortization";
import { round0, sum } from "../shared/num";
import { FEE_MIN, normalizeFee } from "./fee";
import { splitItems, STRUCTURE_KEYS, STRUCTURES } from "./structure";
import { dealStudy } from "./study";
import type { Borrower, CreditFlags, DealInput, DealItem, DealStudy, Structure } from "./types";

export type AlternativeTone = "good" | "maybe" | "no";

export type AlternativeCode =
  | "STRUCTURE_CLOSES"
  | "DISCOUNT_CLOSES"
  | "FEE_MIN_CLOSES"
  | "FEE_MIN_NOT_ENOUGH"
  | "ZERO_FEE_STILL_SHORT"
  | "PERSONAL_COVERS_UNDER_5PCT"
  | "PERSONAL_PARTIAL_COVER"
  | "KEEP_PERSONAL_TOP_UP"
  | "HIGHER_VALUATION"
  | "CO_BORROWER";

/** A way to make a deal close, or the reason a way does not work. */
export interface Alternative {
  code: AlternativeCode;
  tone: AlternativeTone;
  params: Record<string, number | string | boolean>;
  /** Change to apply to the deal input to try this alternative. */
  patch?: Partial<DealInput>;
}

export function compareStructures(
  x: DealInput,
  b: Borrower,
  credit?: CreditFlags | null,
): { structure: Structure; study: DealStudy }[] {
  return STRUCTURE_KEYS.map((structure) => ({ structure, study: dealStudy({ ...x, structure }, b, credit) }));
}

/** Smallest t in [lo, hi] with f(t) >= 0, for an increasing f. Null when even hi is not enough. */
function solve(f: (t: number) => number, lo: number, hi: number): number | null {
  if (f(hi) < 0) return null;
  if (f(lo) >= 0) return lo;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= 0) hi = mid;
    else lo = mid;
  }
  return hi;
}

const negotiable = (i: DealItem) => i.by === "company" && (i.kind === "execution" || i.kind === "default");

/** Items after a discount share `d` on what the company settles. */
const discounted = (x: DealInput, d: number): DealItem[] =>
  x.items.map((i) => (negotiable(i) ? { ...i, pay: round0(i.pay * (1 - d)) } : i));

/**
 * The deal's items with a discount share `d` (0.2 is twenty percent) on the court orders and defaults
 * the company settles, the only amounts a negotiation moves. A discounted amount is no longer what the
 * creditor's letter says, so it is not confirmed.
 */
export function withDiscount(x: Pick<DealInput, "items">, d: number): DealItem[] {
  return x.items.map((i) => (negotiable(i) && d > 0 ? { ...i, pay: round0(i.pay * (1 - d)), confirmed: false } : i));
}

/** Alternatives worked out automatically when the current structure does not close. */
export function dealAlternatives(x: DealInput, b: Borrower, credit?: CreditFlags | null): Alternative[] {
  const current = dealStudy(x, b, credit);
  const out: Alternative[] = [];
  const st = STRUCTURES[current.structure];

  // 1) Other structures that close.
  for (const { structure, study } of compareStructures(x, b, credit)) {
    if (structure === current.structure) continue;
    if (study.verdict === "go" || study.verdict === "tight") {
      out.push({
        code: "STRUCTURE_CLOSES",
        tone: "good",
        params: { structure, clientNet: study.clientNet, fee: study.fee },
        patch: { structure },
      });
    }
  }
  if (current.verdict === "go" || current.verdict === "needs_info") return out;

  const net = (patch: Partial<DealInput>, borrower: Borrower = b) =>
    dealStudy({ ...x, ...patch }, borrower, credit).clientNet;

  // 2) Settlement discount, with the fee recalculated.
  const settledAt = (d: number) => sum(discounted(x, d).filter(negotiable), (i) => i.pay);
  const discount = solve((t) => net({ items: discounted(x, t) }), 0, 0.95);
  if (discount != null && discount > 0) {
    const pct = Math.ceil(discount * 100);
    out.push({
      code: "DISCOUNT_CLOSES",
      tone: pct <= 35 ? "good" : pct <= 55 ? "maybe" : "no",
      params: { pct, payAfter: settledAt(discount), payBefore: settledAt(0) },
      patch: { items: discounted(x, discount) },
    });
  }

  // 3) The company's fee.
  const fee = normalizeFee(x.fee);
  if (fee.settlePct > FEE_MIN || fee.financePct > FEE_MIN || fee.fixed) {
    const minFee = { ...fee, settlePct: FEE_MIN, financePct: FEE_MIN, fixed: 0 };
    const atMin = net({ fee: minFee });
    out.push(
      atMin >= 0
        ? { code: "FEE_MIN_CLOSES", tone: "good", params: { pct: FEE_MIN, clientNet: atMin }, patch: { fee: minFee } }
        : { code: "FEE_MIN_NOT_ENOUGH", tone: "no", params: { deficit: -atMin } },
    );
  }
  const atZero = net({ fee: { ...fee, settlePct: 0, financePct: 0, fixed: 0 } });
  if (atZero < 0) out.push({ code: "ZERO_FEE_STILL_SHORT", tone: "no", params: { deficit: -atZero } });

  // 4) Personal finance only: how much does it really cover?
  if (!st.mortgage && discount == null) {
    const atMaxDiscount = dealStudy({ ...x, items: discounted(x, 0.95) }, b, credit);
    out.push({ code: "PERSONAL_COVERS_UNDER_5PCT", tone: "no", params: { personalCash: atMaxDiscount.personalCash } });
  }
  if (!st.mortgage) {
    const room = current.personalCash - current.feeFinance;
    const covers = Math.max(0, round0(room / (1 + fee.settlePct / 100)));
    out.push({ code: "PERSONAL_PARTIAL_COVER", tone: "maybe", params: { covers, settleBase: current.settleBase } });
  }

  // 4b) Keep the existing personal finance and take a top-up instead of buying it out.
  const bought = splitItems(x).active.filter((i) => i.by === "bank");
  if (st.personal && bought.length && bought.every((i) => i.monthly)) {
    const left = Math.max(0, current.financing.personalInstallment - sum(bought, (i) => i.monthly || 0));
    const topUp = round0(principalFrom(left, current.financing.personalMonths, x.personalFlat, "flat"));
    const netTopUp = topUp - adminFee(topUp);
    const better = netTopUp > current.personalCash;
    out.push({
      code: "KEEP_PERSONAL_TOP_UP",
      tone: better ? "maybe" : "no",
      params: { netTopUp, left, personalCash: current.personalCash, better },
    });
  }

  // 5) The property: a higher valuation, or a co-borrower.
  if (st.mortgage && x.propertyValue) {
    const f = current.financing;
    if (f.mortgageByLtv != null && f.mortgageByLtv <= f.mortgageByIncome) {
      const value = solve((t) => net({ propertyValue: t }), x.propertyValue, x.propertyValue * 2);
      if (value != null) {
        out.push({
          code: "HIGHER_VALUATION",
          tone: value <= x.propertyValue * 1.15 ? "maybe" : "no",
          params: { value, upliftPct: Math.round((value / x.propertyValue - 1) * 100) },
        });
      }
    } else {
      // A co-borrower raises the mortgage only. Personal finance stays on the client's salary.
      const keepPersonal = st.personal ? { bankPersonal: x.bankPersonal ?? f.personal } : {};
      const baseSalary = b.totalSalary ?? b.basicSalary ?? 0;
      const extra = solve((t) => net(keepPersonal, { ...b, totalSalary: baseSalary + t }), 0, 40000);
      if (extra != null && extra > 0) {
        out.push({ code: "CO_BORROWER", tone: "maybe", params: { salary: Math.ceil(extra / 500) * 500 } });
      }
    }
  }
  return out;
}
