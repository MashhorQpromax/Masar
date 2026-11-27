import { describe, expect, it } from "vitest";
import { riyadhDay } from "@/server/shared/clock";

describe("the day in Riyadh", () => {
  it("is written the way SIMAH writes a date", () => {
    expect(riyadhDay(new Date("2026-11-22T09:00:00Z"))).toBe("2026/11/22");
  });

  it("turns at midnight in Riyadh, three hours before midnight UTC", () => {
    expect(riyadhDay(new Date("2026-11-22T20:59:59Z"))).toBe("2026/11/22");
    expect(riyadhDay(new Date("2026-11-22T21:00:00Z"))).toBe("2026/11/23");
    expect(riyadhDay(new Date("2026-12-31T22:30:00Z"))).toBe("2027/01/01");
  });
});
