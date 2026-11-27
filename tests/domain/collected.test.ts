import { describe, expect, it } from "vitest";
import { COLLECTED_MAX, collectedGap, collectedRefusal, STAGES, toHalala } from "@/domain/deal";

/** The fee the office actually collected: recorded by a person, on a closed deal only. */
describe("recording a collected fee", () => {
  it("is taken on a closed deal and on no other stage", () => {
    for (const [stage] of STAGES) expect(collectedRefusal({ stage, amount: 40000 }), stage).toBe(stage === "closed" ? null : "NOT_CLOSED");
  });

  it("takes any amount of money from nothing to the most allowed, and refuses what is not one", () => {
    for (const amount of [0, 0.5, 40000, 102000.75, COLLECTED_MAX]) expect(collectedRefusal({ stage: "closed", amount }), String(amount)).toBeNull();
    for (const amount of [-1, COLLECTED_MAX + 1, Number.NaN, Number.POSITIVE_INFINITY]) expect(collectedRefusal({ stage: "closed", amount }), String(amount)).toBe("AMOUNT");
  });

  it("lets a recorded amount be taken back, on a closed deal only", () => {
    expect(collectedRefusal({ stage: "closed", amount: null })).toBeNull();
    expect(collectedRefusal({ stage: "recovered", amount: null })).toBe("NOT_CLOSED");
  });

  it("keeps amounts to the halala", () => {
    expect(toHalala(10250.507)).toBe(10250.51);
    expect(toHalala(10250.504)).toBe(10250.5);
    expect(toHalala(10250.5)).toBe(10250.5);
    expect(toHalala(100000)).toBe(100000);
  });

  it("says how far the collected stands from the counted, and nothing when either is unknown", () => {
    expect(collectedGap(102000, 100000)).toBe(-2000);
    expect(collectedGap(102000, 102000)).toBe(0);
    expect(collectedGap(102000, 103500.5)).toBe(1500.5);
    expect(collectedGap(null, 100000)).toBeNull();
    expect(collectedGap(102000, null)).toBeNull();
  });
});
