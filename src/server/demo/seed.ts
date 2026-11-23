import "server-only";
import { emptyReport, type CreditReport, type ParsedReport } from "@/domain/credit";
import { defaultDealInput, type DealInput, type Stage } from "@/domain/deal";
import { INBOX_PAPER, type PaperCode } from "@/domain/documents";
import { LINK_DAYS } from "@/domain/messages";
import { addCreditReport } from "../credit/service";
import type { Db } from "../db/client";
import { tokenHash } from "../auth/secret";
import { clients, shareLinks, waMessages } from "../db/schema";
import { getDeal, saveDeal, setDealStage } from "../deals/service";
import { addPaper, keepFile, reviewPaper } from "../documents/service";
import { seedCatalogue } from "../lenders/service";
import { DEMO_LINK_SECRET, linkToken, reachable } from "../messages/links";
import { SYSTEM } from "../shared/actor";
import { riyadhDay } from "../shared/clock";

const DAY = 24 * 60 * 60 * 1000;

interface DemoDeal {
  fileNo: string;
  name: string;
  /** A made-up number. It reaches nobody. */
  phone: string;
  birthYear: number;
  basicSalary: number;
  totalSalary: number;
  serviceMonths: number;
  /** The code of the bank the salary is paid into, when it is known. */
  salaryBank?: string;
  input: DealInput;
  /** Stages the deal has entered after the study, with how many days ago each one started. */
  path: [Stage, number][];
  /** Days since the study started. */
  startedDaysAgo: number;
  /** The client's SIMAH record as it was read, when one was. `day` gives the date that many days ago. */
  credit?: { readDaysAgo: number; reading: (day: (daysAgo: number) => string) => DemoReading };
  /** What the client's file holds: each paper with its made-up files and what was said about it. */
  papers?: DemoPaper[];
  /** The conversation so far, oldest first. A message from the client may carry a made-up file. */
  thread?: { from: "office" | "client"; hoursAgo: number; body: string; file?: string }[];
  /** How many times the client opened their link. */
  linkViews?: number;
}

interface DemoPaper {
  /** A paper the engine knows, or the name of one a person added. */
  paper: PaperCode | { added: string };
  /** The names of the files kept for it. */
  files: string[];
  verdict?: "verified" | { sentBack: string };
}

const kept = (paper: DemoPaper["paper"], ...files: string[]): DemoPaper => ({ paper, files });
const good = (paper: DemoPaper["paper"], ...files: string[]): DemoPaper => ({ paper, files, verdict: "verified" });

/**
 * A one-page PDF that says it is made up. The demo's papers open like real ones, and nothing in them
 * belongs to anyone.
 */
function madeUpPdf(serial: string): Uint8Array {
  const page = `BT /F1 20 Tf 60 760 Td (Masar demo paper ${serial}) Tj 0 -30 Td /F1 13 Tf (Made-up data. It belongs to no one.) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${page.length} >>\nstream\n${page}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const table = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return new TextEncoder().encode(`${body}xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${body.length}\n%%EOF\n`);
}

type DemoReading = Pick<ParsedReport, "warnings" | "confidence"> & { report: Partial<CreditReport> };

const base = defaultDealInput();

/**
 * Four invented deals, one per situation the home map has to show: close to disbursement,
 * mid-way, a thin margin, and a deal that does not close. No real person or number is used.
 * Every figure on screen is computed by the real engine from these inputs.
 *
 * Three of them carry an invented SIMAH record that tells the same story as the deal's items, one per
 * state the credit page has to show: read again after the debt was cleared, closed by a confirmed
 * suspension, and closed by a suspension nobody has checked yet. The fourth has no report, which is
 * the page's empty state.
 *
 * The lenders they are held against are the base catalogue, as a new database gets it.
 */
const DEALS: DemoDeal[] = [
  {
    fileNo: "C-019",
    name: "فهد",
    phone: "0500000019",
    birthYear: 1985,
    basicSalary: 14500,
    totalSalary: 19800,
    serviceMonths: 190,
    input: {
      ...base,
      items: [
        { id: "i1", kind: "execution", label: "قرار تنفيذ 55120 — شركة تمويل", original: 96000, pay: 82000, by: "company" },
        { id: "i2", kind: "default", label: "تعثر بطاقة — بنك", original: 21000, pay: 18000, by: "company" },
        { id: "i3", kind: "mortgage_payoff", label: "مخالصة العقاري — بنك", original: 402000, pay: 385000, by: "company", confirmed: true, monthly: 3900 },
        { id: "i4", kind: "personal_payoff", label: "مخالصة الشخصي — بنك", original: 74000, pay: 70000, by: "bank", monthly: 2600 },
      ],
      propertyValue: 1050000,
      fixedCosts: 12000,
      fee: { settlePct: 15, settleIncludesPayoff: false, financePct: 15, financeBase: "total", fixed: 0 },
      targetBank: "بنك الراتب",
      bankMortgage: 900000,
      bankPersonal: 240000,
    },
    startedDaysAgo: 47,
    path: [
      ["agreement", 45],
      ["settlement", 43],
      ["clearance", 40],
      ["simah_update", 35],
      ["payoff", 25],
      ["transfer", 15],
      ["bank_submit", 12],
      ["approval", 9],
    ],
    // Close to the end: everything arrived and was verified, but the SIMAH report was never read.
    papers: [
      good("id", "الهوية.pdf"),
      good("address", "العنوان الوطني.pdf"),
      good("obligations", "خطاب مديونية 1.pdf", "خطاب مديونية 2.pdf", "خطاب سداد مبكر.pdf"),
      good("salary_cert", "تعريف بالراتب.pdf"),
      good("bank_3", "كشف الحساب.pdf"),
      good("deed", "الصك.pdf"),
      good("valuation", "التقييم.pdf"),
      good("agreement", "الاتفاقية.pdf"),
      good("clearance", "مخالصة التنفيذ.pdf", "مخالصة البطاقة.pdf"),
      good("payoff_letter", "مخالصة العقاري.pdf"),
      good("transfer_deed", "الصك بعد الإفراغ.pdf"),
    ],
  },
  {
    fileNo: "C-014",
    name: "سالم",
    phone: "0500000014",
    birthYear: 1989,
    basicSalary: 11000,
    totalSalary: 15200,
    serviceMonths: 150,
    salaryBank: "rajhi",
    input: {
      ...base,
      items: [
        { id: "i1", kind: "execution", label: "قرار تنفيذ 31877 — شركة اتصالات", original: 38000, pay: 31000, by: "company" },
        { id: "i2", kind: "mortgage_payoff", label: "مخالصة العقاري — بنك", original: 331000, pay: 318000, by: "company", confirmed: true, monthly: 3100 },
        { id: "i3", kind: "personal_payoff", label: "مخالصة الشخصي — بنك", original: 52000, pay: 49000, by: "bank", monthly: 1900 },
      ],
      propertyValue: 760000,
      fixedCosts: 8000,
    },
    startedDaysAgo: 31,
    path: [
      ["agreement", 29],
      ["settlement", 27],
      ["clearance", 24],
      ["simah_update", 19],
      ["payoff", 9],
    ],
    // Mid-way: some verified, some waiting to be looked at, one sent back, and what the bank will ask for still owed.
    papers: [
      good("id", "الهوية.pdf"),
      good("address", "العنوان الوطني.pdf"),
      good("obligations", "خطاب مديونية.pdf", "خطاب سداد مبكر.pdf"),
      good("deed", "الصك.pdf"),
      good("agreement", "الاتفاقية.pdf"),
      kept("clearance", "مخالصة التنفيذ.pdf"),
      kept("bank_3", "كشف الحساب 1.pdf", "كشف الحساب 2.pdf", "كشف الحساب 3.pdf"),
      { paper: "salary_cert", files: ["تعريف بالراتب.pdf"], verdict: { sentBack: "مضى عليه أكثر من شهر" } },
      kept({ added: "خطاب تثبيت من جهة العمل" }),
    ],
    // The office asked for a newer salary letter, and the client answered with it in WhatsApp.
    thread: [
      { from: "office", hoursAgo: 52, body: "السلام عليكم ورحمة الله سالم\nتعريف الراتب الذي وصلنا مضى عليه أكثر من شهر. نحتاج واحداً جديداً لنكمل ملفك." },
      { from: "client", hoursAgo: 5, body: "وعليكم السلام، هذا التعريف الجديد", file: "تعريف جديد.pdf" },
      { from: "client", hoursAgo: 5, body: "متى يتحدث سجلي في سمة؟" },
    ],
    linkViews: 3,
    // Read again after the order was paid and SIMAH updated: the debt shows as settled history.
    credit: {
      readDaysAgo: 12,
      reading: (day) => ({
        confidence: "high",
        warnings: [],
        report: {
          reportDate: day(13),
          reportMonthsAgo: 0,
          score: 640,
          facilities: [
            { lender: "شركة اتصالات", creditorType: "telecom", product: "خط مفوتر", status: "settled", defaultAmount: 38000, defaultNow: 0, settledMonthsAgo: 0 },
            { lender: "بنك", creditorType: "bank", product: "تمويل عقاري", status: "current", balance: 331000, installment: 3100, openedAt: "2019/06/11" },
            { lender: "بنك", creditorType: "bank", product: "تمويل شخصي", status: "current", balance: 52000, installment: 1900, openedAt: "2023/02/19" },
            { lender: "بنك", creditorType: "bank", product: "بطاقة ائتمانية", status: "current", limit: 20000, balance: 6500 },
          ],
          judgments: [{ kind: "enforcement", active: false, amount: 38000, remaining: 0, creditor: "شركة اتصالات", date: "2026/01/12", state: "منتهي", decisionNo: "31877" }],
          inquiries6m: 1,
          inquiries12m: 2,
          inquiries: [{ date: day(40), lender: "بنك", product: "تمويل عقاري", amount: 760000 }],
        },
      }),
    },
  },
  {
    fileNo: "C-017",
    name: "نورة",
    phone: "0500000017",
    birthYear: 1992,
    basicSalary: 9800,
    totalSalary: 13400,
    serviceMonths: 110,
    input: {
      ...base,
      structure: "settle_personal",
      items: [
        { id: "i1", kind: "execution", label: "قرار تنفيذ 77241 — شركة تمويل", original: 104000, pay: 95000, by: "company" },
        { id: "i2", kind: "default", label: "تعثر تمويل سيارة — شركة تمويل", original: 46000, pay: 39000, by: "company" },
        { id: "i3", kind: "personal_payoff", label: "مخالصة الشخصي — بنك", original: 44000, pay: 41000, by: "bank", monthly: 1500 },
      ],
      fee: { settlePct: 15, settleIncludesPayoff: false, financePct: 10, financeBase: "total", fixed: 0 },
    },
    startedDaysAgo: 5,
    path: [
      ["agreement", 3],
      ["settlement", 1],
    ],
    // Early: the first papers arrived and nobody has looked at them yet.
    papers: [kept("id", "الهوية.pdf"), kept("address", "العنوان الوطني.pdf"), kept("obligations", "خطاب مديونية.pdf"), kept("agreement", "الاتفاقية.pdf")],
    // The suspension was checked in Najiz and is real.
    credit: {
      readDaysAgo: 5,
      reading: (day) => ({
        confidence: "high",
        warnings: [],
        report: {
          reportDate: day(6),
          reportMonthsAgo: 0,
          facilities: [
            { lender: "شركة تمويل", creditorType: "finance_company", product: "تمويل شخصي", status: "default", defaultAmount: 104000, defaultNow: 104000, defaultListedAt: "2025/12/03", defaultMonthsAgo: 11 },
            { lender: "شركة تمويل", creditorType: "finance_company", product: "تمويل سيارة", status: "default", defaultAmount: 46000, defaultNow: 46000, defaultListedAt: "2026/04/11", defaultMonthsAgo: 7 },
            { lender: "بنك", creditorType: "bank", product: "تمويل شخصي", status: "current", balance: 44000, installment: 1500, openedAt: "2024/01/08" },
          ],
          judgments: [{ kind: "enforcement", active: true, amount: 104000, remaining: 104000, creditor: null, date: "2026/05/19", state: "عدم تنفيذ", decisionNo: "77241" }],
          serviceSuspension: true,
          suspensionAssumed: false,
          inquiries6m: 2,
          inquiries12m: 3,
          notes: "تحققنا من ناجز: الإيقاف قائم على قرار التنفيذ.",
        },
      }),
    },
  },
  {
    fileNo: "C-021",
    name: "ريم",
    phone: "0500000021",
    birthYear: 1981,
    basicSalary: 10500,
    totalSalary: 14100,
    serviceMonths: 230,
    salaryBank: "snb",
    input: {
      ...base,
      items: [
        { id: "i1", kind: "execution", label: "قرار تنفيذ 90412 — شركة تمويل", original: 142000, pay: 142000, by: "company" },
        { id: "i2", kind: "default", label: "تعثر — بنك", original: 58000, pay: 58000, by: "company" },
        { id: "i3", kind: "mortgage_payoff", label: "مخالصة العقاري — بنك", original: 412000, pay: 400000, by: "company", monthly: 4100 },
        { id: "i4", kind: "personal_payoff", label: "مخالصة الشخصي — بنك", original: 66000, pay: 63000, by: "bank", monthly: 2300 },
      ],
      propertyValue: 720000,
    },
    startedDaysAgo: 0,
    path: [],
    // Just read: an unpaid order, so a suspension is assumed until someone checks Absher or Najiz.
    credit: {
      readDaysAgo: 0,
      reading: (day) => ({
        // As the reader gives it: the assumption is a warning, and does not lower how sure the reading is.
        confidence: "high",
        warnings: [{ code: "SUSPENSION_ASSUMED", params: { orders: 1 } }],
        report: {
          reportDate: day(2),
          reportMonthsAgo: 0,
          score: 512,
          facilities: [
            { lender: "شركة تمويل", creditorType: "finance_company", product: "تمويل شخصي", status: "default", defaultAmount: 142000, defaultNow: 142000, defaultListedAt: "2025/09/14", defaultMonthsAgo: 14 },
            { lender: "بنك", creditorType: "bank", product: "بطاقة ائتمانية", status: "default", limit: 60000, balance: 58000, defaultAmount: 58000, defaultNow: 58000, defaultListedAt: "2026/01/20", defaultMonthsAgo: 10 },
            { lender: "بنك", creditorType: "bank", product: "تمويل عقاري", status: "current", balance: 412000, installment: 4100, openedAt: "2019/04/02" },
            { lender: "بنك", creditorType: "bank", product: "تمويل شخصي", status: "late", balance: 66000, installment: 2300, overdue: 4600, worstDelay: 60, lastDelayMonthsAgo: 1 },
            { lender: "شركة اتصالات", creditorType: "telecom", product: "خط مفوتر", status: "current", balance: 0 },
          ],
          judgments: [{ kind: "enforcement", active: true, amount: 142000, remaining: 142000, creditor: null, date: "2026/02/08", state: "عدم تنفيذ", decisionNo: "90412" }],
          serviceSuspension: true,
          suspensionAssumed: true,
          inquiries6m: 5,
          inquiries12m: 7,
          inquiries: [
            { date: day(9), lender: "شركة تمويل", product: "تمويل شخصي", amount: 80000 },
            { date: day(24), lender: "بنك", product: "تمويل شخصي", amount: 150000 },
            { date: day(51), lender: "شركة تمويل", product: "تمويل سيارة", amount: null },
            { date: day(88), lender: "بنك", product: "بطاقة ائتمانية", amount: 30000 },
            { date: day(120), lender: "شركة تمويل", product: "تمويل شخصي", amount: 100000 },
          ],
        },
      }),
    },
  },
];

/** Fills an empty database with the demo deals, dated relative to `now` so the map always looks alive. */
export async function seedDemo(db: Db, now: Date): Promise<void> {
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  await seedCatalogue(db);
  for (const demo of DEALS) {
    const [client] = await db
      .insert(clients)
      .values({
        fileNo: demo.fileNo,
        fullName: demo.name,
        phone: demo.phone,
        birthYear: demo.birthYear,
        basicSalary: demo.basicSalary,
        totalSalary: demo.totalSalary,
        serviceMonths: demo.serviceMonths,
        salaryBank: demo.salaryBank ?? null,
        sector: "gov",
        createdAt: ago(demo.startedDaysAgo),
        updatedAt: ago(demo.startedDaysAgo),
      })
      .returning({ id: clients.id });
    const { dealId } = await saveDeal(db, {
      clientId: client!.id,
      input: demo.input,
      actor: SYSTEM,
      now: ago(demo.startedDaysAgo),
    });
    for (const [stage, daysAgo] of demo.path) {
      await setDealStage(db, { dealId, stage, actor: SYSTEM, now: ago(daysAgo) });
    }
    if (demo.credit) {
      const { report, ...rest } = demo.credit.reading((daysAgo) => riyadhDay(ago(daysAgo)));
      await addCreditReport(db, {
        clientId: client!.id,
        reading: { ...rest, report: { ...emptyReport(), ...report } },
        actor: SYSTEM,
        now: ago(demo.credit.readDaysAgo),
      });
    }
    for (const [index, entry] of (demo.papers ?? []).entries()) {
      const at = ago(Math.max(0, demo.startedDaysAgo - 1));
      const code = typeof entry.paper === "string" ? entry.paper : (await addPaper(db, { clientId: client!.id, label: entry.paper.added, actor: SYSTEM, now: at })).code;
      let paperId: number | null = null;
      for (const [page, name] of entry.files.entries()) {
        const bytes = madeUpPdf(`${demo.fileNo} ${index + 1}.${page + 1}`);
        paperId = (await db.transaction((tx) => keepFile(tx, { clientId: client!.id, code, name, bytes, actor: SYSTEM, now: at }))).paperId;
      }
      if (paperId != null && entry.verdict) {
        const review = entry.verdict === "verified" ? { verdict: "verified" } : { verdict: "rejected", note: entry.verdict.sentBack };
        await reviewPaper(db, { clientId: client!.id, paperId, review, actor: SYSTEM, now: at });
      }
    }
    for (const [index, said] of (demo.thread ?? []).entries()) {
      const at = new Date(now.getTime() - said.hoursAgo * 3_600_000);
      const fileId = said.file
        ? (await db.transaction((tx) => keepFile(tx, { clientId: client!.id, code: INBOX_PAPER, name: said.file!, bytes: madeUpPdf(`${demo.fileNo} wa.${index + 1}`), actor: SYSTEM, now: at, via: "whatsapp" }))).fileId
        : null;
      await db.insert(waMessages).values({
        clientId: client!.id,
        direction: said.from === "client" ? "in" : "out",
        waId: `demo.${demo.fileNo}.${index + 1}`,
        phone: `9665000000${demo.phone.slice(-2)}`,
        type: said.file ? "document" : "text",
        body: said.body,
        fileId,
        status: said.from === "client" ? "received" : "read",
        createdAt: at,
        updatedAt: at,
      });
    }
    // A client the office may write to has a link. Its token is the same on every copy of the demo.
    const view = await getDeal(db, { dealId, now });
    if (view && reachable(view)) {
      const seed = `demo:${demo.fileNo}`;
      await db.insert(shareLinks).values({
        tokenHash: tokenHash(linkToken(DEMO_LINK_SECRET, seed)),
        seed,
        clientId: client!.id,
        expiresAt: new Date(now.getTime() + (LINK_DAYS - 3) * DAY),
        views: demo.linkViews ?? 0,
        lastViewAt: demo.linkViews ? new Date(now.getTime() - 6 * 3_600_000) : null,
        createdAt: ago(3),
      });
    }
  }
}
