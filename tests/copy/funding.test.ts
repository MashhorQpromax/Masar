import { describe, expect, it } from "vitest";
import { ledgerText } from "@/copy/deal";
import { ROUTE_ERROR_CODES, ROUTE_STATUS, routeCheckText, routeError, routeLenders, routeNoteText } from "@/copy/funding";
import { defaultDealInput, type Borrower, type DealInput } from "@/domain/deal";
import type { Product } from "@/domain/eligibility";
import { fundingRoutes, type FundingRoute, type RecordAfter } from "@/domain/funding";

const broken = /undefined|NaN|null|\[object|[A-Za-z_]{3,}|—|–/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");

const product = (id: string, lender: string, parts: Partial<Product>): Product => ({
  id,
  lenderId: lender,
  lenderName: `جهة ${lender}`,
  lenderType: "bank",
  bankCode: lender,
  financeType: "personal",
  name: "منتج",
  minSalary: 4000,
  minAge: 21,
  maxAgeAtMaturity: 65,
  minServiceMonths: 3,
  sectors: ["gov"],
  nationalities: ["saudi"],
  maxTenor: 60,
  maxAmount: 2_000_000,
  rate: 3.2,
  rateType: "flat",
  requiresSalaryTransfer: true,
  acceptsLateSimah: false,
  maxLtv: null,
  notes: null,
  settledDefaultWaitMonths: 0,
  verified: false,
  ...parts,
});
const home = (id: string, lender: string, parts: Partial<Product> = {}) =>
  product(id, lender, { financeType: "mortgage", maxAgeAtMaturity: 70, maxTenor: 300, maxAmount: 5_000_000, rate: 5, rateType: "reducing", maxLtv: 90, ...parts });

const deal: DealInput = {
  ...defaultDealInput(),
  items: [{ id: "a", kind: "execution", label: "قرار تنفيذ", original: 100000, pay: 100000, by: "company" }],
  propertyValue: 800000,
};
const people: Borrower[] = [
  { age: 35, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" },
  { age: 19, basicSalary: 2000, totalSalary: 3000, serviceMonths: 1, sector: "private" },
  { age: 68, basicSalary: 9000, totalSalary: 12000, serviceMonths: 300, sector: "retired" },
  { age: null, basicSalary: null, totalSalary: null, serviceMonths: null, sector: "gov" },
];
const records: RecordAfter[] = [
  { known: true, open: false, settledMonthsAgo: null, delays: false },
  { known: false, open: false, settledMonthsAgo: 0, delays: false },
  { known: true, open: true, settledMonthsAgo: null, delays: false },
  { known: true, open: false, settledMonthsAgo: 3, delays: true },
];
const catalogues: Product[][] = [
  [product("1", "a", {}), home("2", "a"), product("3", "b", { settledDefaultWaitMonths: 12, acceptsLateSimah: true }), home("4", "b", { settledDefaultWaitMonths: null })],
  [product("1", "a", { settledDefaultWaitMonths: null }), home("2", "b", { settledDefaultWaitMonths: 12 })],
  [product("1", "a", { nationalities: ["non_saudi"], maxAmount: 50000 }), home("2", "a", { maxAmount: 200000, sectors: ["gov", "retired", "private"] })],
];

const every: FundingRoute[] = [];
for (const borrower of people) {
  for (const record of records) {
    for (const products of catalogues) {
      for (const salaryBank of ["a", null]) {
        for (const structure of ["settle_refi_personal", "settle_personal", "settle_refi"] as const) {
          every.push(...fundingRoutes({ input: { ...deal, structure }, borrower, who: { nationality: "saudi", salaryBank, record }, products }));
        }
      }
    }
  }
}

describe("funding wording", () => {
  it("has a sentence for every condition a route can raise", () => {
    const seen = new Set<string>();
    for (const route of every) {
      for (const leg of [route.mortgage, route.personal]) {
        for (const check of leg?.checks ?? []) {
          const text = routeCheckText(check);
          expect(strip(text), check.code).not.toMatch(broken);
          expect(text.endsWith("."), check.code).toBe(true);
          seen.add(`${check.code}:${check.status === "pass" ? "pass" : "other"}`);
        }
      }
      for (const note of [...route.conditions, ...route.refusals]) {
        const text = routeNoteText(note, route);
        expect(strip(text), note.check.code).not.toMatch(broken);
        seen.add(`${note.check.code}:other`);
      }
      expect(routeLenders(route).main.length).toBeGreaterThan(2);
      expect(ROUTE_STATUS[route.status]).toBeTruthy();
    }
    const codes = new Set([...seen].map((s) => s.split(":")[0]));
    for (const code of ["RECORD_OPEN", "RECORD_LATE", "RECORD_UNKNOWN", "RECORD_CLEAN", "SETTLED_ACCEPTED", "SETTLED_UNCONFIRMED", "SETTLED_WAIT", "TWO_SALARY_TRANSFERS", "SALARY_TRANSFER", "SECTOR", "NATIONALITY", "SALARY_MIN", "SALARY_MISSING", "AGE_MISSING", "AGE_BELOW_MIN", "AGE_OVER_MAX", "SERVICE_MIN", "SERVICE_MISSING", "SERVICE_NOT_NEEDED"]) {
      expect(codes, code).toContain(code);
    }
  });

  it("names the lender only when the route has two", () => {
    const two = every.find((r) => !r.oneLender && r.conditions.some((n) => n.check.code === "SETTLED_UNCONFIRMED"))!;
    const note = two.conditions.find((n) => n.check.code === "SETTLED_UNCONFIRMED")!;
    expect(routeNoteText(note, two)).toBe(`${note.lender}: لم نؤكد معها متى تقبل عميلاً سدّد تعثره.`);
    expect(routeNoteText(note, { oneLender: true })).toBe("لم نؤكد معها متى تقبل عميلاً سدّد تعثره.");
    expect(routeLenders(two)).toEqual({ main: two.mortgage!.product.lenderName, also: `والشخصي من ${two.personal!.product.lenderName}` });
    expect(strip(routeCheckText({ key: "simah", status: "fail", code: "SETTLED_WAIT", params: { months: 12 } }))).toBe("لا تقبل من سدّد تعثره إلا بعد مدة، والباقي منها 12 شهراً.");
  });

  it("words a lender's ceiling in the deal's ledger", () => {
    const held = every.find((r) => r.mortgage?.atCeiling && r.personal?.atCeiling)!;
    const lines = held.study.ledger.filter((l) => l.key === "ceiling" || ((l.key === "principal" || l.key === "mortgage") && l.params?.held));
    expect(lines.map((l) => `${l.section}.${l.key}`)).toEqual(["personal.ceiling", "personal.principal", "mortgage.ceiling", "mortgage.mortgage"]);
    expect(lines.map((l) => strip(ledgerText(l).label))).toEqual(["سقف جهة a للشخصي", "أصل التمويل: سقف الجهة", "سقف جهة a للعقاري", "العقاري: سقف الجهة"]);
    for (const line of lines) expect(strip(`${ledgerText(line).label} ${ledgerText(line).how ?? ""}`)).not.toMatch(/undefined|NaN|null|\[object/);
  });

  it("has a sentence for every refusal to apply a route", () => {
    for (const code of ROUTE_ERROR_CODES) expect(strip(routeError(code))).not.toMatch(broken);
    expect(routeError("SOMETHING_ELSE")).toBe("تعذر الحفظ. حاول مرة أخرى.");
  });
});
