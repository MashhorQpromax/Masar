import { describe, expect, it } from "vitest";
import {
  APPROVE_REFUSAL,
  CONSENT_WAY,
  CONTACT_KIND,
  CONTACT_PROBLEM,
  CONTACTS_SAY,
  FOLLOW_UP_SAY,
  lenderMessage,
  NAMES_NOBODY,
  SENDS_NOTHING,
  PREPARE_REFUSAL,
  recordSaid,
  REQUEST_STATUS,
  requestError,
  SEND_REFUSAL,
  serviceSaid,
  waitedSaid,
} from "@/copy/requests";
import { CONTACT_VALIDITY_MONTHS, type SharedFacts } from "@/domain/request";

const wordy = /undefined|NaN|null|\[object|[A-Za-z_]{3,}|—|–/;

const facts: SharedFacts = {
  ref: "C-017",
  legs: [
    {
      part: "mortgage",
      product: "التمويل العقاري",
      amount: 812_400.4,
      months: 240,
    },
    {
      part: "personal",
      product: "التمويل الشخصي",
      amount: 230_009,
      months: 60,
    },
  ],
  age: 36,
  nationality: "saudi",
  sector: "gov",
  contractType: "permanent",
  serviceMonths: 126,
  basicSalary: 12_000,
  totalSalary: 16_000,
  salaryBank: "بنك المثال",
  incomeVerified: true,
  keptMonthly: 1_250,
  record: { known: true, open: false, settledMonthsAgo: 0, delays: false },
};

describe("the message a lender reads", () => {
  it("says what is asked and who asks it, plainly, without a stray word", () => {
    const text = lenderMessage(facts);
    expect(text).not.toMatch(wordy);
    expect(text).toContain("مرجعه عندنا C-017");
    expect(text).toContain("- التمويل العقاري من منتج «التمويل العقاري»: نحو 812,400 ريال على 240 شهراً.");
    expect(text).toContain("- الراتب الأساسي: 12,000 ريال");
    expect(text).toContain("- مدة الخدمة: 10 سنوات و6 أشهر");
    expect(text).toContain("- السجل الائتماني: فيه تعثر يُسدَّد قبل التقديم وتُرفق مخالصته.");
    expect(text).toContain("نرجو ردكم كتابةً");
    // Plain text a person pastes: no direction marks.
    expect(text).not.toMatch(/[⁦-⁩‎‏]/);
  });

  it("leaves out what the file does not say, rather than saying nothing in words", () => {
    const text = lenderMessage({
      ...facts,
      age: null,
      contractType: null,
      serviceMonths: null,
      basicSalary: null,
      salaryBank: null,
      incomeVerified: false,
      keptMonthly: 0,
    });
    expect(text).not.toMatch(wordy);
    expect(text).not.toContain("العمر");
    expect(text).not.toContain("العقد:");
    expect(text).not.toContain("بنك الراتب");
    expect(text).toContain("- توثيق الراتب: لم يُوثَّق بمستند بعد");
    expect(text).toContain("- الالتزامات الشهرية بعد التسوية: لا شيء");
  });

  it("reads the credit record the way the lender will see it after the deal", () => {
    expect(
      recordSaid({
        known: false,
        open: false,
        settledMonthsAgo: null,
        delays: false,
      }),
    ).toBe("لم يُقرأ تقرير سمة بعد.");
    expect(
      recordSaid({
        known: true,
        open: true,
        settledMonthsAgo: null,
        delays: true,
      }),
    ).toBe("فيه تعثر قائم لم يُسدَّد، وفيه تأخر في السداد مؤخراً.");
    expect(
      recordSaid({
        known: true,
        open: false,
        settledMonthsAgo: 14,
        delays: false,
      }),
    ).toBe("فيه تعثر سُدِّد قبل 14 شهراً.");
    expect(
      recordSaid({
        known: true,
        open: false,
        settledMonthsAgo: null,
        delays: false,
      }),
    ).toBe("لا تعثر فيه ولا تأخر.");
    expect(serviceSaid(8)).toBe("8 أشهر");
    expect(serviceSaid(24)).toBe("سنتان");
    expect(serviceSaid(13)).toBe("سنة وشهر");
  });
});

describe("the words of the requests screens", () => {
  it("names every status, kind, way and refusal without a stray word", () => {
    for (const table of [REQUEST_STATUS, CONTACT_KIND, CONTACT_PROBLEM, CONSENT_WAY, PREPARE_REFUSAL, APPROVE_REFUSAL, SEND_REFUSAL]) {
      for (const [key, text] of Object.entries(table)) {
        expect(text, key).toMatch(/[؀-ۿ]/);
        expect(text, key).not.toMatch(wordy);
      }
    }
    for (const [code, reason] of [
      ["REQUEST_REFUSED", "OPEN_REQUEST"],
      ["APPROVAL_REFUSED", "STALE"],
      ["SEND_REFUSED", "CONTACT"],
      ["BAD_EMAIL", ""],
      ["BAD_LINK", ""],
      ["SOMETHING_NEW", ""],
    ] as const) {
      expect(requestError(code, { reason })).not.toMatch(wordy);
    }
    expect(requestError("REQUEST_REFUSED", { reason: "NO_SHARING" })).toBe(PREPARE_REFUSAL.NO_SHARING);
    expect(waitedSaid(0)).toBe("أُرسل اليوم");
    expect(waitedSaid(9)).toBe("أُرسل قبل 9 أيام");
  });

  it("says the screens' standing lines plainly, and says the months a check lasts as the rule has them", () => {
    for (const line of [CONTACTS_SAY, FOLLOW_UP_SAY, NAMES_NOBODY, SENDS_NOTHING]) expect(line).not.toMatch(wordy);
    expect(CONTACT_VALIDITY_MONTHS).toBe(6);
    expect(CONTACTS_SAY).toContain("ستة أشهر");
  });
});
