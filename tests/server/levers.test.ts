import { describe, expect, it } from "vitest";
import { leversQuery, parseLevers } from "@/server/deals/levers";

describe("a scenario's levers, from the address", () => {
  it("reads what is given, in Arabic digits or with separators", () => {
    expect(parseLevers({ structure: "settle_personal", financePct: "١٥", discountPct: "20", bankMortgage: "750,000", financeBase: "net" })).toEqual({
      structure: "settle_personal",
      financePct: 15,
      discountPct: 20,
      bankMortgage: 750000,
      financeBase: "net",
    });
    expect(parseLevers({ settlePct: "12.5" })).toEqual({ settlePct: 12.5 });
  });

  it("leaves out what is empty, unknown or out of bounds, and never fails", () => {
    expect(parseLevers({})).toEqual({});
    expect(parseLevers({ structure: "everything", financePct: "90", discountPct: "", bankPersonal: "0", propertyValue: "abc", other: "1" })).toEqual({});
    expect(parseLevers({ financePct: ["12", "30"] })).toEqual({ financePct: 12 });
  });

  it("writes them back in one order", () => {
    expect(leversQuery({ discountPct: 20, structure: "settle_refi" })).toBe("?structure=settle_refi&discountPct=20");
    expect(leversQuery({})).toBe("");
  });
});
