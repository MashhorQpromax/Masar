import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCESS,
  actionText,
  actionTitle,
  blockerText,
  CONFIDENCE,
  creditError,
  CREDITOR_TYPE,
  doorText,
  draftLabel,
  FACILITY_STATUS,
  findingText,
  GRADE,
  JUDGMENT_KIND,
  parseWarningText,
  readText,
  STANDING,
  UPLOAD_ERROR_CODES,
} from "@/copy/credit";
import { analyzeCredit, parseSimahPages, type CreditReport } from "@/domain/credit";
import { itemDrafts, type Owed } from "@/domain/deal";

const golden = JSON.parse(readFileSync(new URL("../golden/credit.json", import.meta.url), "utf8"));
const cases: { report: CreditReport; obligations: Owed[]; expected: { items: { label: string }[] } }[] = golden.cases;
const broken = /undefined|NaN|null|\[object/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");

describe("credit wording", () => {
  it("has a sentence for every blocker, finding, step and door the engine produces", () => {
    const seen = new Set<string>();
    for (const c of cases) {
      const a = analyzeCredit(c.report);
      const said: [string, string][] = [
        ...a.blockers.map((b): [string, string] => [`blocker.${b.code}`, blockerText(b)]),
        ...a.findings.map((f): [string, string] => [`finding.${f.code}`, findingText(f)]),
        ...a.actions.map((x): [string, string] => [`action.${x.code}`, actionText(x)]),
        [`banks.${a.banks.reason}`, doorText(a.banks).reason],
        [`financeCompanies.${a.financeCompanies.reason}`, doorText(a.financeCompanies).reason],
      ];
      for (const [code, text] of said) {
        expect(text.length, code).toBeGreaterThan(8);
        expect(text, code).not.toMatch(broken);
        expect(text.endsWith("."), code).toBe(true);
        seen.add(code);
      }
      for (const x of a.actions) {
        const title = actionTitle(x);
        expect(title.length, x.code).toBeGreaterThan(8);
        expect(title, x.code).not.toMatch(broken);
        // A heading is shorter than the instruction it stands over, and carries no full stop.
        expect(title.length, x.code).toBeLessThan(actionText(x).length);
        expect(title.endsWith("."), x.code).toBe(false);
      }
      for (const d of [a.banks, a.financeCompanies]) {
        const { reopen } = doorText(d);
        expect(reopen === null, d.reason).toBe(!d.reopenInMonths);
        if (reopen) expect(reopen).not.toMatch(broken);
      }
      expect(GRADE[a.grade].title).toBeTruthy();
      expect(STANDING[a.standing]).toBeTruthy();
      expect(ACCESS[a.banks.access]).toBeTruthy();
    }
    // 5 blockers, 12 findings, 9 steps, 7 reasons for banks and 4 for finance companies.
    expect(seen.size).toBe(37);
  });

  it("says what a reading found and why a report was refused", () => {
    expect(strip(readText({ facilities: 7, judgments: 1 }))).toBe("قرأنا التقرير: 7 منتجات وقرار تنفيذ واحد.");
    expect(strip(readText({ facilities: 12, judgments: 0 }))).toBe("قرأنا التقرير: 12 منتجاً.");
    expect(readText({ facilities: 0, judgments: 0 })).toBe("قرأنا التقرير.");
    // Every answer of the upload has its own sentence, different from the fallback.
    const fallback = creditError("SOMETHING_ELSE");
    for (const code of ["DEMO", "NO_FILE", "TOO_LARGE", "NOT_PDF", "UNREADABLE", "NOT_SIMAH", "NOT_FOUND", "INVALID_INPUT"]) {
      expect(UPLOAD_ERROR_CODES, code).toContain(code);
      expect(creditError(code), code).not.toBe(fallback);
      expect(creditError(code).endsWith("."), code).toBe(true);
    }
  });

  it("names every kind the record can hold", () => {
    for (const table of [CREDITOR_TYPE, FACILITY_STATUS, JUDGMENT_KIND, ACCESS, STANDING]) {
      for (const text of Object.values(table)) expect(text).toBeTruthy();
    }
  });

  it("says who a court order is for, and says when that is a guess", () => {
    const a = analyzeCredit({
      facilities: [{ lender: "شركة تمويل", creditorType: "finance_company", product: "قرض شخصي", status: "default", defaultAmount: 128000 }],
      judgments: [
        { kind: "enforcement", active: true, amount: 128400, date: "2025/03/11", state: "عدم تنفيذ" },
        { kind: "judgment", active: true, amount: 9000.4, creditor: "دائن فرد" },
      ],
      serviceSuspension: false,
    });
    expect(a.blockers.map((b) => strip(blockerText(b)))).toEqual([
      "قرار تنفيذ قائم لصالح شركة تمويل على الأرجح، بمبلغ 128,400 ريال، صدر في 2025/03/11، حالته: عدم تنفيذ.",
      "حكم قائم لصالح دائن فرد، بمبلغ 9,000 ريال.",
      "تعثر قائم لدى شركة تمويل (شركة تمويل)، المتبقي 128,000 ريال، ومرفوع به قرار تنفيذ.",
    ]);
  });

  it("counts in correct Arabic", () => {
    expect(strip(findingText({ code: "BANK_DEFAULTS", level: "warn", params: { count: 1, waitMonths: 12 } }))).toMatch(/^تعثر واحد لدى بنوك\. .*نحو 12 شهراً/);
    expect(strip(findingText({ code: "FINANCE_CO_DEFAULTS", level: "warn", params: { count: 2, waitMonths: 24 } }))).toMatch(/^تعثران لدى شركات تمويل/);
    expect(strip(findingText({ code: "RECENT_DELAYS", level: "warn", params: { count: 3, worstDelay: 90, windowMonths: 12 } }))).toBe(
      "تأخر 30 يوماً فأكثر على 3 التزامات خلال آخر 12 شهراً. أسوأ تأخر 90 يوماً.",
    );
    expect(strip(findingText({ code: "SETTLED_DEFAULT", level: "info", params: { lender: "بنك", creditorType: "bank", monthsAgo: 0, amount: null } }))).toBe(
      "تعثر مسدد لدى بنك (بنك) منذ أقل من شهر. يبقى ظاهراً في السجل كتاريخ.",
    );
    expect(strip(doorText({ access: "closed", reason: "RECENT_SETTLEMENT_BANK", reopenInMonths: 2 }).reopen ?? "")).toBe("يُتوقع أن يفتح بعد شهرين.");
  });
});

describe("wording of a report's reading", () => {
  const texts = JSON.parse(readFileSync(new URL("../golden/simah.json", import.meta.url), "utf8")) as { today: string; cases: { pages: string[] }[] };

  it("has a sentence for every warning the reader raises", () => {
    const seen = new Set<string>();
    for (const c of texts.cases) {
      const reading = parseSimahPages(c.pages, texts.today);
      expect(CONFIDENCE[reading.confidence]).toBeTruthy();
      for (const warning of reading.warnings) {
        const text = parseWarningText(warning);
        expect(text.length, warning.code).toBeGreaterThan(10);
        expect(text, warning.code).not.toMatch(broken);
        seen.add(warning.code);
      }
    }
    expect(seen.size).toBe(5);
  });

  it("counts unpaid orders in correct Arabic", () => {
    expect(parseWarningText({ code: "SUSPENSION_ASSUMED", params: { orders: 1 } })).toMatch(/^قرار تنفيذ لم يُنفّذ\. افترضنا/);
    expect(parseWarningText({ code: "SUSPENSION_ASSUMED", params: { orders: 3 } })).toMatch(/^3 قرارات تنفيذ لم تُنفّذ\. /);
  });
});

describe("labels of the items a deal starts with", () => {
  /** The label the old system wrote, without the dangling separator it left when no lender was known. */
  const old = (label: string) => label.replace(/\s+/g, " ").replace(/ —\s*$/, "").trim();

  it("match the labels the old system wrote", () => {
    let compared = 0;
    for (const c of cases) {
      if (c.report.judgments.some((j) => j.active && j.kind === "bounced_cheque")) continue;
      const drafts = itemDrafts(c.report, c.obligations);
      expect(drafts.length).toBe(c.expected.items.length);
      drafts.forEach((draft, i) => {
        // The old system called a court judgment an enforcement order too. The new label says which it is.
        const label = draftLabel(draft.source).replace(/^حكم/, "قرار تنفيذ");
        expect(label).toBe(old(c.expected.items[i]!.label));
        compared++;
      });
    }
    expect(compared).toBeGreaterThan(700);
  });

  it("name a bounced cheque as a cheque and a judgment as a judgment", () => {
    expect(draftLabel({ from: "judgment", kind: "bounced_cheque", decisionNo: null, creditor: null, date: null })).toBe("شيك مرتجع — دائن غير محدد");
    expect(draftLabel({ from: "judgment", kind: "judgment", decisionNo: "4410077123", creditor: "بنك", date: "2025/03/11" })).toBe("حكم 4410077123 — بنك (2025/03/11)");
    expect(draftLabel({ from: "obligation", kind: "auto", lender: null })).toBe("مخالصة تمويل سيارة");
  });
});
