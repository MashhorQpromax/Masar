import { describe, expect, it } from "vitest";
import { defaultDealInput, type DealInput } from "@/domain/deal";
import { borrowerInputSchema } from "@/server/clients/input";
import { dealInputSchema } from "@/server/deals/input";

const borrower = { fullName: "عميل تجريبي", birthYear: 1991, sector: "gov", basicSalary: 12000, totalSalary: 16000, serviceMonths: 120 };

const input: DealInput = {
  ...defaultDealInput(),
  items: [{ id: "a", kind: "execution", label: "قرار تنفيذ — شركة تمويل", original: 100000, pay: 90000, by: "company" }],
  propertyValue: 800000,
};

const refused = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) => expect(schema.safeParse(value).success).toBe(false);

describe("what a deal accepts", () => {
  it("accepts what the editor sends", () => {
    expect(dealInputSchema.safeParse(input).success).toBe(true);
  });

  it("refuses numbers that are not numbers", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, "800000", 10_000_000_001]) {
      refused(dealInputSchema, { ...input, propertyValue: value });
    }
    refused(dealInputSchema, { ...input, personalMonths: 60.5 });
    refused(dealInputSchema, { ...input, fee: { ...input.fee, financePct: 101 } });
  });

  it("refuses a missing form, a missing field and an unknown choice", () => {
    refused(dealInputSchema, undefined);
    refused(dealInputSchema, {});
    refused(dealInputSchema, { ...input, notes: undefined });
    refused(dealInputSchema, { ...input, structure: "something_else" });
    refused(dealInputSchema, { ...input, items: [{ ...input.items[0], by: "nobody" }] });
  });

  it("refuses two obligations with one id, and more obligations than a deal can hold", () => {
    refused(dealInputSchema, { ...input, items: [input.items[0], input.items[0]] });
    refused(dealInputSchema, { ...input, items: Array.from({ length: 61 }, (_, n) => ({ ...input.items[0], id: `i${n}` })) });
  });
});

describe("what a client's facts accept", () => {
  it("accepts the editor's facts and trims the name", () => {
    const parsed = borrowerInputSchema.parse({ ...borrower, fullName: "  عميل تجريبي  " });
    expect(parsed.fullName).toBe("عميل تجريبي");
  });

  it("drops what the form has no place for", () => {
    const parsed = borrowerInputSchema.parse({ ...borrower, fileNo: "C-999", role: "admin" });
    expect(Object.keys(parsed).sort()).toEqual(["basicSalary", "birthYear", "fullName", "sector", "serviceMonths", "totalSalary"]);
  });

  it("refuses a minor, a basic salary above the total, and an unknown employer", () => {
    refused(borrowerInputSchema, { ...borrower, birthYear: new Date().getFullYear() - 10 });
    refused(borrowerInputSchema, { ...borrower, basicSalary: 20000 });
    refused(borrowerInputSchema, { ...borrower, sector: "royal" });
    refused(borrowerInputSchema, { ...borrower, fullName: " " });
    refused(borrowerInputSchema, { ...borrower, totalSalary: Number.POSITIVE_INFINITY });
  });
});
