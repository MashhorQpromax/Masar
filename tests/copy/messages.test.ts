import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { plainMoney } from "@/copy/format";
import {
  about,
  ESTIMATE_MARK,
  ESTIMATE_NOTE,
  CLIENT_NOW,
  CLIENT_STEP,
  firstName,
  GATE_REASON,
  internalText,
  MESSAGE_ERROR_CODES,
  MESSAGE_KIND,
  messageError,
  OFFICE_NAME,
  papersText,
  progressText,
  studyText,
  waRuns,
  type MessageExtras,
} from "@/copy/messages";
import { dealStudy, STAGES, stationsFor, type DealInput } from "@/domain/deal";
import { clientFacts, LINK_DAYS, MESSAGE_KINDS } from "@/domain/messages";

const golden = JSON.parse(readFileSync(new URL("../golden/deal.json", import.meta.url), "utf8"));
const cases: { input: DealInput; borrower: never; credit: never }[] = golden.cases;
const broken = /undefined|NaN|null|\[object|—|–|[⁦⁩]/;

const extras: MessageExtras = {
  first: "سالم",
  staff: "خالد",
  owed: [
    { label: "تعريف بالراتب لا يتجاوز شهراً", note: "مضى عليه أكثر من شهر" },
    { label: "كشف حساب آخر 3 إلى 6 أشهر", note: null },
  ],
  link: "https://masarfin.com/s/abcdefghijklmnopqrstuvwxyzABCDEF",
};

const steps = (structure: DealInput["structure"], at: number) =>
  stationsFor(structure).map((key, index) => ({ key, state: index < at ? ("done" as const) : index === at ? ("current" as const) : ("ahead" as const) }));

/** Every run of digits in a text, as written. */
const numbers = (text: string): string[] => text.match(/\d[\d,.]*\d|\d/g) ?? [];

describe("the messages for the client", () => {
  it("never carry a number the client is not meant to know", () => {
    let withFee = 0;
    for (const c of cases) {
      const study = dealStudy(c.input, c.borrower, c.credit);
      const facts = clientFacts({ stage: "settlement", input: c.input, study });
      const texts = [studyText(facts, extras), studyText(facts, { ...extras, nameLender: true }), papersText(extras), progressText(facts, steps(c.input.structure, 1), extras)];

      const total = facts.financing.reduce((sum, part) => sum + part.amount, 0);
      const allowed = new Set<string>([
        ...[facts.settles, facts.payoff, facts.keeps, total, ...facts.financing.map((part) => part.amount)].flatMap((amount) => numbers(about(amount))),
        // What a lender wrote is said to the riyal.
        ...[...facts.financing.filter((part) => part.certainty === "confirmed").map((part) => part.amount), ...(facts.keepsCertainty === "confirmed" ? [facts.keeps] : [])].flatMap((amount) => numbers(plainMoney(amount))),
        String(facts.weeks.from),
        String(facts.weeks.to),
        String(LINK_DAYS),
        // List numbers, and the digits inside the papers' own names.
        ...Array.from({ length: 9 }, (_, index) => String(index + 1)),
        ...extras.owed.flatMap((paper) => numbers(paper.label)),
        // Names of lenders and of what is paid off are the client's own, digits and all.
        ...facts.payoffAt.flatMap(numbers),
        ...facts.financing.flatMap((part) => numbers(part.lender ?? "")),
      ]);
      for (const text of texts) {
        expect(text).not.toMatch(broken);
        const body = text.replace(extras.link!, "");
        for (const found of numbers(body)) expect(allowed.has(found.replace(/\.$/, "")), `${found} in:\n${body}`).toBe(true);
        expect(body).not.toMatch(/أتعاب|رأس المال|عمولة|ربح|هامش/);
      }
      if (study.fee > 0) withFee += 1;
    }
    expect(withFee).toBeGreaterThan(200);
  });

  it("greet by name, sign with the office, and end with the link", () => {
    const c = cases.find((entry) => dealStudy(entry.input, entry.borrower, entry.credit).verdict === "go")!;
    const facts = clientFacts({ stage: "study", input: c.input, study: dealStudy(c.input, c.borrower, c.credit) });
    const text = studyText(facts, extras);
    expect(text.startsWith(`السلام عليكم ورحمة الله سالم\nمعك خالد من *${OFFICE_NAME}*.`)).toBe(true);
    expect(text).toContain(extras.link!);
    expect(text).toContain(`صالح ${LINK_DAYS} يوماً`);
    expect(text).toContain("1. تعريف بالراتب لا يتجاوز شهراً (نحتاجه من جديد: مضى عليه أكثر من شهر)");
    expect(text).toContain(`_${ESTIMATE_NOTE}_`);
    expect(studyText(facts, { ...extras, staff: null, link: null })).toContain(`معك فريق *${OFFICE_NAME}*.`);
    expect(studyText(facts, { ...extras, link: null })).not.toContain("رابط");
  });

  it("lead with the lender we found, by its kind unless a person chooses to name it", () => {
    const input: DealInput = { ...cases[0]!.input, structure: "settle_refi_personal", targetBank: "بنك الراتب", personalLender: "بنك الراتب", personalLenderKind: "bank", bankMortgage: null, bankPersonal: null };
    const borrower = { age: 38, basicSalary: 15000, totalSalary: 21000, serviceMonths: 160, sector: "gov" };
    const facts = clientFacts({ stage: "study", input, study: dealStudy(input, borrower) });
    if (facts.financing.some((part) => part.lender)) {
      const quiet = studyText(facts, extras);
      expect(quiet).toContain("*بشارة: وفرنا لك جهة تمويلية*");
      expect(quiet).not.toContain("بنك الراتب");
      expect(studyText(facts, { ...extras, nameLender: true })).toContain("*بنك الراتب*");
    }
    const withOffer: DealInput = { ...input, bankMortgage: 700000, bankPersonal: 150000 };
    const offered = clientFacts({ stage: "approval", input: withOffer, study: dealStudy(withOffer, borrower) });
    expect(studyText(offered, extras)).toContain("*بشارة: صدر عرض تمويلك*");
    expect(studyText(offered, extras)).toContain("*850,000* ريال");
  });

  it("say a figure from the lender's written offer as it is, and mark a counted one as an estimate", () => {
    const input: DealInput = { ...cases[0]!.input, structure: "settle_refi_personal", propertyValue: 1_000_000, bankMortgage: 700000, bankPersonal: null };
    const borrower = { age: 38, basicSalary: 15000, totalSalary: 21000, serviceMonths: 160, sector: "gov" };
    const facts = clientFacts({ stage: "approval", input, study: dealStudy(input, borrower) });
    expect(facts.financing.map((part) => [part.part, part.certainty])).toEqual([
      ["mortgage", "confirmed"],
      ["personal", "estimated"],
    ]);
    const text = studyText(facts, extras);
    expect(text).toContain("- تمويل عقاري *700,000* ريال، بعرض مكتوب من الجهة");
    expect(text).toMatch(new RegExp(`- تمويل شخصي نحو \\*[\\d,]+\\* ريال \\(تقديري\\)`));
    // What the client keeps rests on counted costs too, so it is marked, and the note says why.
    expect(facts.keepsCertainty).toBe("estimated");
    if (facts.keeps > 0) expect(text).toContain(`ريال ${ESTIMATE_MARK}\n`);
    expect(text).toContain(`_${ESTIMATE_NOTE}_`);
  });

  it("drop the note when everything they are told stands on written words", () => {
    const facts = {
      financing: [{ part: "mortgage" as const, amount: 700000, lender: null, lenderKind: null, certainty: "confirmed" as const }],
      keeps: 52000,
      keepsCertainty: "confirmed" as const,
    };
    const full = { ...clientFacts({ stage: "approval", input: cases[0]!.input, study: dealStudy(cases[0]!.input, cases[0]!.borrower, cases[0]!.credit) }), ...facts };
    const text = studyText(full, extras);
    expect(text).toContain("- يبقى لك نقداً بعد سداد كل التزاماتك *52,000* ريال\n");
    expect(text).not.toContain(ESTIMATE_MARK);
    expect(text).not.toContain(ESTIMATE_NOTE);
  });

  it("ask for the papers owed and nothing else", () => {
    const text = papersText(extras);
    expect(text).toContain("لنكمل ملفك بأسرع وقت نحتاج منك:");
    expect(text).toContain("2. كشف حساب آخر 3 إلى 6 أشهر");
    expect(text).toContain("ارفعها من الرابط بالأسفل");
    expect(papersText({ ...extras, link: null })).toContain("أرسلها هنا صوراً واضحة أو ملفات PDF.");
    expect(papersText({ ...extras, owed: [] })).toContain("وصلتنا كل مستنداتك");
    expect(text).not.toMatch(/ريال|عقاري|شخصي/);
  });

  it("show the road with the current step marked", () => {
    const c = cases[0]!;
    const facts = clientFacts({ stage: "simah_update", input: { ...c.input, structure: "settle_refi_personal" }, study: dealStudy(c.input, c.borrower, c.credit) });
    const text = progressText(facts, steps("settle_refi_personal", 2), extras);
    expect(text).toContain("1. دراسة الملف والاتفاق (تم)");
    expect(text).toContain("3. *تحديث سجلك في سمة* (الآن)");
    expect(text).toContain("6. صرف التمويل");
    expect(text).toContain(`*الآن:* ${CLIENT_NOW.simah_update}`);
    expect(text).toContain("ما زال ينقصنا: تعريف بالراتب لا يتجاوز شهراً، كشف حساب آخر 3 إلى 6 أشهر.");
  });
});

describe("the internal summary", () => {
  it("carries the company's numbers, which is why it is never for the client", () => {
    for (const c of cases.slice(0, 80)) {
      const study = dealStudy(c.input, c.borrower, c.credit);
      const text = internalText({ clientName: "سالم بن فهد", fileNo: "C-014", input: c.input, study });
      expect(text).not.toMatch(broken);
      expect(text).toContain("*ملخص صفقة، داخلي*");
      expect(text).toContain(`*الإجمالي: ${plainMoney(study.fee)}*`);
      expect(text).toContain(`رأس المال الذي ندفعه مؤقتاً: ${plainMoney(study.capital)}`);
      expect(text).toContain(study.summary.net >= 0 ? `*يبقى للعميل ${plainMoney(study.summary.net)} ريال*` : `*عجز ${plainMoney(-study.summary.net)} ريال.*`);
    }
  });
});

describe("the small words around messages", () => {
  it("has a name and a hint for every message, and a reason for every closed gate", () => {
    for (const kind of MESSAGE_KINDS) {
      expect(MESSAGE_KIND[kind].label.length).toBeGreaterThan(3);
      expect(MESSAGE_KIND[kind].hint).toMatch(/\.$/);
    }
    for (const reason of ["REJECTED", "DEFICIT", "STUDY_OPEN"] as const) expect(GATE_REASON[reason]).toMatch(/\.$/);
  });

  it("has the client's words for every station and every stage", () => {
    for (const key of stationsFor("settle_refi_personal")) expect(CLIENT_STEP[key].length).toBeGreaterThan(5);
    for (const [stage] of STAGES) expect(CLIENT_NOW[stage]).toMatch(/\.$/);
  });

  it("says what went wrong in a full sentence", () => {
    for (const code of [...MESSAGE_ERROR_CODES, "ANYTHING_ELSE"]) {
      const text = messageError(code);
      expect(text).toMatch(/\.$/);
      expect(text).not.toMatch(broken);
    }
    for (const code of ["DEMO", "WA_OFF", "NO_PHONE", "GATE_CLOSED", "MESSAGE_EMPTY", "SEND_FAILED", "NOT_FOUND", "INVALID_INPUT"]) expect(MESSAGE_ERROR_CODES).toContain(code);
  });

  it("rounds an amount the way a person says it", () => {
    expect(about(1_254_000)).toBe("1.25 مليون");
    expect(about(2_000_000)).toBe("2 مليون");
    expect(about(184_600)).toBe("185,000");
    expect(about(9_450)).toBe("9,450");
    expect(firstName("  سالم بن فهد ")).toBe("سالم");
    expect(firstName("")).toBe("");
  });

  it("reads WhatsApp's marks at the edge of a word and leaves a link alone", () => {
    expect(waRuns("معك *مسار* اليوم")).toEqual([
      { text: "معك ", mark: null },
      { text: "مسار", mark: "bold" },
      { text: " اليوم", mark: null },
    ]);
    expect(waRuns("_رابط خاص بك._")).toEqual([{ text: "رابط خاص بك.", mark: "soft" }]);
    // A link's own underscores and stars are not marks, wherever they fall in it.
    for (const link of ["https://masarfin.com/s/ab_cd_ef-gh", "https://masarfin.com/s/_abc_def", "https://masarfin.com/s/-x_6k4TBw_yz", "a*b*c", "2*3*4"]) {
      expect(waRuns(link)).toEqual([{ text: link, mark: null }]);
    }
    expect(waRuns("*الحل*\n1. نسدد")).toEqual([
      { text: "الحل", mark: "bold" },
      { text: "\n1. نسدد", mark: null },
    ]);
    expect(waRuns("")).toEqual([]);
  });
});
