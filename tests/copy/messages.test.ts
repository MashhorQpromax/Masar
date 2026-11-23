import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { plainMoney } from "@/copy/format";
import {
  about,
  ESTIMATE_MARK,
  ESTIMATE_NOTE,
  CLIENT_NOW,
  CLIENT_STEP,
  feeItemLine,
  feeItemWhat,
  firstName,
  GATE_REASON,
  internalText,
  MESSAGE_ERROR_CODES,
  MESSAGE_KIND,
  messageError,
  OFFER,
  OFFER_BASE,
  OFFER_COST,
  OFFER_WAITS,
  offerText,
  OFFICE_NAME,
  papersText,
  progressText,
  studyText,
  waRuns,
  type MessageExtras,
} from "@/copy/messages";
import { dealStudy, defaultDealInput, feePlan, STAGES, stationsFor, type DealInput } from "@/domain/deal";
import { clientFacts, clientOffer, LINK_DAYS, MESSAGE_KINDS } from "@/domain/messages";

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

  it("carry the fee only in the final offer, where every number is the client's own and none is the office's capital or return", () => {
    let made = 0;
    for (const c of cases) {
      const study = dealStudy(c.input, c.borrower, c.credit);
      const offer = clientOffer({ input: c.input, study }, feePlan(c.input, study));
      if (!offer) continue;
      made += 1;
      const facts = clientFacts({ stage: "agreement", input: c.input, study });
      const allowed = new Set<string>([
        ...[offer.totalFinancing, offer.keeps, offer.fee.total, offer.obligations?.amount ?? 0, ...offer.financing.map((part) => part.amount), ...offer.costs.map((cost) => cost.amount)].flatMap((amount) => numbers(plainMoney(amount))),
        ...offer.fee.items.flatMap((item) => (item.kind === "fixed" ? numbers(plainMoney(item.amount)) : [...numbers(plainMoney(item.amount)), ...numbers(plainMoney(item.base)), ...numbers(`${Number.isInteger(item.pct) ? item.pct : item.pct.toFixed(1)}`)])),
        String(LINK_DAYS),
        ...facts.financing.flatMap((part) => numbers(part.lender ?? "")),
      ]);
      for (const text of [offerText(facts, offer, extras), offerText(facts, offer, { ...extras, nameLender: true })]) {
        expect(text).not.toMatch(broken);
        const body = text.replace(extras.link!, "");
        for (const found of numbers(body)) expect(allowed.has(found.replace(/\.$/, "")), `${found} in:\n${body}`).toBe(true);
        // The fee is said by its name. What the office puts in and what it earns on it are never said.
        expect(body).toContain(OFFER.fee);
        expect(body).not.toMatch(/رأس المال|عمولة|ربح|هامش|عائد|تغطية|ندفعه مؤقتاً/);
        expect(body).toContain(`*${OFFER.keeps}: ${plainMoney(study.clientNet)} ريال*`);
      }
    }
    expect(made).toBeGreaterThan(60);
  });

  it("write the final offer as a sum: the financing, what is paid out of it, the fee item by item, and what is left", () => {
    const input: DealInput = {
      ...defaultDealInput(),
      items: [
        { id: "a", kind: "execution", label: "قرار تنفيذ — شركة تمويل", original: 90000, pay: 80000, by: "company", confirmed: true },
        { id: "b", kind: "default", label: "تعثر — بنك", original: 20000, pay: 20000, by: "company", confirmed: true },
        { id: "c", kind: "mortgage_payoff", label: "مخالصة العقاري — بنك الأول", original: 400000, pay: 390000, by: "company", confirmed: true },
      ],
      propertyValue: 1_000_000,
      targetBank: "بنك الراتب",
      personalLender: "بنك الراتب",
      personalLenderKind: "bank",
      bankMortgage: 850000,
      bankPersonal: null,
      fee: { settlePct: 10, settleIncludesPayoff: false, financePct: 12.5, financeBase: "total", fixed: 5000 },
    };
    const study = dealStudy(input, { age: 40, basicSalary: 14000, totalSalary: 19000, serviceMonths: 180, sector: "gov" });
    const offer = clientOffer({ input, study }, feePlan(input, study))!;
    const facts = clientFacts({ stage: "agreement", input, study });
    const text = offerText(facts, offer, extras);
    const personal = offer.financing.find((part) => part.part === "personal")!.amount;
    expect(text.startsWith(`السلام عليكم ورحمة الله سالم\nمعك خالد من *${OFFICE_NAME}*.\n\n*${OFFER.title}*`)).toBe(true);
    expect(text).toContain("- تمويل عقاري: 850,000 ريال، بعرض مكتوب من الجهة");
    expect(text).toContain(`- تمويل شخصي: ${plainMoney(personal)} ريال ${ESTIMATE_MARK}`);
    expect(text).toContain(`المجموع: *${plainMoney(850000 + personal)}* ريال`);
    expect(text).toContain("- التزاماتك التي نسددها ونخالصها عنك: 490,000 ريال\n");
    for (const cost of offer.costs) expect(text).toContain(`- ${OFFER_COST[cost.kind]}: ${plainMoney(cost.amount)} ريال ${ESTIMATE_MARK}`);
    expect(text).toContain("- 10% على ما نسدده عنك (100,000 ريال): 10,000 ريال");
    expect(text).toContain(`- 12.5% على كامل التمويل (${plainMoney(study.financeBase)} ريال): ${plainMoney(study.feeFinance)} ريال`);
    expect(text).toContain("- مبلغ مقطوع: 5,000 ريال");
    expect(text).toContain(`${OFFER.feeTotal}: *${plainMoney(study.fee)}* ريال ${ESTIMATE_MARK}`);
    expect(text).toContain(`*${OFFER.keeps}: ${plainMoney(study.clientNet)} ريال* ${ESTIMATE_MARK}`);
    expect(text).toContain(`_${ESTIMATE_NOTE}_`);
    expect(text).toContain(extras.link!);
    // The lender is named only when the person chooses to.
    expect(text).not.toContain("بنك الراتب");
    expect(offerText(facts, offer, { ...extras, nameLender: true })).toContain("- تمويل شخصي من *بنك الراتب*:");
  });

  it("say one fee item on one line, and a fee of nothing as it is", () => {
    expect(feeItemLine({ kind: "settle", pct: 10, base: 100000, includesPayoff: true, amount: 10000 })).toBe("10% على ما نسدده ونخالصه عنك (100,000 ريال): 10,000 ريال");
    for (const on of ["total", "personal", "mortgage", "net"] as const) {
      expect(feeItemWhat({ kind: "finance", pct: 10, base: 1, on, amount: 1 })).toBe(`على ${OFFER_BASE[on]}`);
      expect(OFFER_BASE[on]).not.toMatch(broken);
    }
    expect(new Set(Object.values(OFFER_BASE)).size).toBe(4);
    expect(new Set(Object.values(OFFER_COST)).size).toBe(4);
    for (const said of [...Object.values(OFFER), ...Object.values(OFFER_COST), OFFER_WAITS]) {
      expect(said).not.toMatch(broken);
      expect(said).not.toMatch(/[A-Za-z_]{3,}/);
    }
    expect(OFFER_WAITS.endsWith(".")).toBe(true);

    const input: DealInput = { ...defaultDealInput(), structure: "settle_personal", items: [], bankPersonal: 150000, fee: { settlePct: 0, settleIncludesPayoff: false, financePct: 0, financeBase: "total", fixed: 0 } };
    const study = dealStudy(input, { age: 35, basicSalary: 12000, totalSalary: 16000, serviceMonths: 120, sector: "gov" });
    const offer = clientOffer({ input, study }, feePlan(input, study));
    if (offer) {
      const text = offerText(clientFacts({ stage: "agreement", input, study }), offer, extras);
      expect(text).toContain(`*${OFFER.fee}*\n${OFFER.noFee}.`);
      expect(text).not.toContain(OFFER.feeTotal);
    }
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
