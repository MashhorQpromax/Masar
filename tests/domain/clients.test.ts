import { describe, expect, it } from "vitest";
import { fileState, idDigits, idProblem, isEmail } from "@/domain/clients";
import { foldText } from "@/domain/shared/text";

describe("an identity number", () => {
  it("is accepted when its check digit agrees", () => {
    expect(idProblem("1010101010", "saudi")).toBeNull();
    expect(idProblem("1000000008", "saudi")).toBeNull();
    expect(idProblem("2000000006", "non_saudi")).toBeNull();
  });

  it("is refused when a digit was mistyped", () => {
    expect(idProblem("1010101011", "saudi")).toBe("ID_CHECK");
    expect(idProblem("1010101100", "saudi")).toBe("ID_CHECK");
    // Every single wrong digit is caught.
    for (let at = 1; at < 10; at++) {
      for (let digit = 0; digit < 10; digit++) {
        const typed = "1010101010".slice(0, at) + digit + "1010101010".slice(at + 1);
        if (typed !== "1010101010") expect(idProblem(typed, "saudi"), typed).toBe("ID_CHECK");
      }
    }
  });

  it("is ten digits that begin with 1 or 2", () => {
    for (const typed of ["", "101010101", "10101010100", "3010101010", "0010101010", "10101o1010"]) expect(idProblem(typed, "saudi"), typed).toBe("ID_FORMAT");
  });

  it("says which kind it is: 1 a citizen, 2 a resident", () => {
    expect(idProblem("2000000006", "saudi")).toBe("ID_KIND");
    expect(idProblem("1010101010", "non_saudi")).toBe("ID_KIND");
  });

  it("is read from any keyboard", () => {
    expect(idDigits(" ١٠١٠١٠١٠١٠ ")).toBe("1010101010");
    expect(idDigits("1010-1010-10")).toBe("1010101010");
  });
});

describe("an email address", () => {
  it("needs a name, an at sign and a domain", () => {
    expect(isEmail("salem@example.com")).toBe(true);
    for (const typed of ["salem", "salem@", "@example.com", "salem@example", "sa lem@example.com", "salem@exa mple.com"]) expect(isEmail(typed), typed).toBe(false);
  });
});

describe("where a file stands", () => {
  it("follows the stage of its newest deal", () => {
    expect(fileState(null)).toEqual({ kind: "none" });
    expect(fileState("closed")).toEqual({ kind: "done" });
    expect(fileState("lost")).toEqual({ kind: "rejected" });
    expect(fileState("study")).toEqual({ kind: "open", stage: "study", station: "study" });
    expect(fileState("payoff")).toEqual({ kind: "open", stage: "payoff", station: "property" });
  });
});

describe("a text as a search compares it", () => {
  it("takes look-alike letters as one", () => {
    expect(foldText("أحمد")).toBe(foldText("احمد"));
    expect(foldText("سارة")).toBe(foldText("ساره"));
    expect(foldText("مصطفى")).toBe(foldText("مصطفي"));
    expect(foldText("إيمان")).toBe(foldText("ايمان"));
    expect(foldText("آمنة")).toBe("امنه");
  });

  it("drops vowel marks, the stretching line, case and extra spaces", () => {
    expect(foldText("مُحَمَّد")).toBe("محمد");
    expect(foldText("محـــمد")).toBe("محمد");
    expect(foldText("  Salem   Ali ")).toBe("salem ali");
  });
});
