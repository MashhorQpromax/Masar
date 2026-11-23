import "server-only";
import { emptyReport, type CreditReport, type ParsedReport } from "@/domain/credit";
import { EMPTY_PROJECT, type ProjectFacts } from "@/domain/project";
import { defaultDealInput, type DealInput, type Stage } from "@/domain/deal";
import { INBOX_PAPER, type PaperCode } from "@/domain/documents";
import { LINK_DAYS } from "@/domain/messages";
import { addCreditReport } from "../credit/service";
import type { Db } from "../db/client";
import { tokenHash } from "../auth/secret";
import { asc, eq, gt } from "drizzle-orm";
import type { Role } from "@/domain/auth";
import { DECOY_HASH } from "../auth/password";
import { auditLog, clients, lenderRules, lenders, outcomes, passkeys, shareLinks, users, waMessages } from "../db/schema";
import { getDeal, rejectDeal, saveDeal, setDealStage } from "../deals/service";
import { addPaper, keepFile, reviewPaper } from "../documents/service";
import { seedCatalogue } from "../lenders/service";
import { DEMO_LINK_SECRET, linkToken, reachable } from "../messages/links";
import { openProject, saveProject } from "../projects/service";
import { SYSTEM } from "../shared/actor";
import { riyadhDay } from "../shared/clock";

const DAY = 24 * 60 * 60 * 1000;

interface DemoDeal {
  fileNo: string;
  name: string;
  /** A made-up number. It reaches nobody. */
  phone: string;
  city: string;
  employer: string;
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
  thread?: { from: "office" | "client"; hoursAgo: number; body: string; file?: string; seen?: boolean }[];
  /** How many times the client opened their link. */
  linkViews?: number;
  /** The file was rejected that many days ago, for this reason. */
  rejected?: { daysAgo: number; reason: string };
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
 * Four invented deals in progress, one per situation the home map has to show: close to disbursement,
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
    city: "الرياض",
    employer: "وزارة التعليم",
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
    // The good news went out, and the client's thanks was marked as needing no answer.
    thread: [
      { from: "office", hoursAgo: 30, body: "السلام عليكم فهد\nوصلت موافقة البنك على تمويلك. بقي توقيع العقود ثم الصرف، ونحدد لك الموعد." },
      { from: "client", hoursAgo: 29, body: "الحمد لله، بانتظاركم", seen: true },
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
    city: "جدة",
    employer: "وزارة الصحة",
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
    city: "الدمام",
    employer: "أمانة المنطقة الشرقية",
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
    city: "المدينة المنورة",
    employer: "وزارة العدل",
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
  // Two files that ended, for the list of everyone: one completed, one rejected. They are not on the road.
  {
    fileNo: "C-008",
    name: "ماجد",
    phone: "0500000008",
    city: "الرياض",
    employer: "وزارة الداخلية",
    birthYear: 1987,
    basicSalary: 12500,
    totalSalary: 16900,
    serviceMonths: 170,
    input: {
      ...base,
      items: [
        { id: "i1", kind: "default", label: "تعثر — شركة تمويل", original: 64000, pay: 55000, by: "company" },
        { id: "i2", kind: "mortgage_payoff", label: "مخالصة العقاري — بنك", original: 318000, pay: 305000, by: "company", confirmed: true, monthly: 3300 },
      ],
      propertyValue: 880000,
      fixedCosts: 10000,
      bankMortgage: 760000,
      bankPersonal: 180000,
    },
    startedDaysAgo: 118,
    path: [
      ["agreement", 116],
      ["settlement", 114],
      ["clearance", 110],
      ["simah_update", 104],
      ["payoff", 96],
      ["transfer", 88],
      ["bank_submit", 86],
      ["approval", 82],
      ["disbursement", 70],
      ["recovered", 65],
      ["closed", 63],
    ],
  },
  {
    fileNo: "C-011",
    name: "هند",
    phone: "0500000011",
    city: "مكة المكرمة",
    employer: "جامعة أم القرى",
    birthYear: 1979,
    basicSalary: 8900,
    totalSalary: 11800,
    serviceMonths: 250,
    input: {
      ...base,
      items: [
        { id: "i1", kind: "execution", label: "قرار تنفيذ 61877 — شركة تمويل", original: 188000, pay: 188000, by: "company" },
        { id: "i2", kind: "mortgage_payoff", label: "مخالصة العقاري — بنك", original: 455000, pay: 446000, by: "company", monthly: 4300 },
      ],
      propertyValue: 640000,
    },
    startedDaysAgo: 26,
    path: [],
    rejected: { daysAgo: 22, reason: "الصفقة لا تُغلق: قيمة العقار لا تغطي السداد، والعميلة لا تملك دفع الفرق." },
    // Read before the file was closed. A new deal for her starts from it: the order, the mortgage at an
    // estimated payoff, the card, and a loan whose installment the record does not give.
    credit: {
      readDaysAgo: 24,
      reading: (day) => ({
        confidence: "high",
        warnings: [],
        report: {
          reportDate: day(25),
          reportMonthsAgo: 0,
          score: 498,
          facilities: [
            { lender: "شركة تمويل", creditorType: "finance_company", product: "تمويل شخصي", status: "default", defaultAmount: 188000, defaultNow: 188000, defaultListedAt: "2025/08/21", defaultMonthsAgo: 15 },
            { lender: "بنك", creditorType: "bank", product: "تمويل عقاري", status: "current", balance: 455000, installment: 4300, openedAt: "2018/03/04" },
            { lender: "بنك", creditorType: "bank", product: "بطاقة ائتمانية", status: "current", limit: 15000, balance: 9200 },
            { lender: "شركة تقسيط", creditorType: "finance_company", product: "تمويل شخصي", status: "late", balance: 27000, overdue: 2400, worstDelay: 30, lastDelayMonthsAgo: 1 },
          ],
          judgments: [{ kind: "enforcement", active: true, amount: 188000, remaining: 188000, creditor: null, date: "2026/03/02", state: "عدم تنفيذ", decisionNo: "61877" }],
          serviceSuspension: true,
          suspensionAssumed: false,
          inquiries6m: 2,
          inquiries12m: 3,
        },
      }),
    },
  },
];

/** Someone who wrote to the company's number before having a file. The name and the number are made up. */
const STRANGERS = [
  {
    phone: "966500000031",
    name: "أبو تركي",
    said: [
      { hoursAgo: 2, body: "السلام عليكم، وصلني رقمكم من صديق. عندي تعثر مسجل في سمة وقرض عقاري قائم، هل لكم حل؟" },
      { hoursAgo: 2, body: "أعمل في جهة حكومية وراتبي 14 ألف" },
    ],
  },
];

/**
 * The people of the made-up office. Nobody can sign in as one of them: a demo has no door, and the
 * password kept for each is the hash of a text nobody knows.
 */
const PEOPLE: { name: string; email: string; role: Role; phone: string | null; joinedDaysAgo: number; lastSeenHoursAgo: number; method: string; active?: false; authenticator?: true }[] = [
  { name: "عبدالله", email: "abdullah@masar.example", role: "admin", phone: "966500000101", joinedDaysAgo: 150, lastSeenHoursAgo: 3, method: "passkey", authenticator: true },
  { name: "منى", email: "mona@masar.example", role: "analyst", phone: "966500000102", joinedDaysAgo: 146, lastSeenHoursAgo: 5, method: "password+totp", authenticator: true },
  { name: "خالد", email: "khalid@masar.example", role: "officer", phone: "966500000103", joinedDaysAgo: 144, lastSeenHoursAgo: 1, method: "password" },
  { name: "سارة", email: "sara@masar.example", role: "viewer", phone: null, joinedDaysAgo: 31, lastSeenHoursAgo: 70, method: "password" },
  { name: "فيصل", email: "faisal@masar.example", role: "officer", phone: null, joinedDaysAgo: 143, lastSeenHoursAgo: 24 * 19, method: "password", active: false },
];

/** Who in the made-up office would have done a thing, by what the thing is. Null is the client or the system. */
function doerOf(action: string, details: Record<string, unknown> | null): string | null {
  if (details?.via === "whatsapp") return null;
  if (action === "client.reject" || action === "client.reopen") return "عبدالله";
  if (action === "doc.review" || action.startsWith("credit.") || action.startsWith("lender.") || action === "deal.route") return "منى";
  return "خالد";
}

const RIYADH = 3 * 3_600_000;
const OPENING = 9 * 3_600_000;
const BETWEEN = 17 * 60_000;
const LAST = 8 * 3_600_000 + 40 * 60_000;

/**
 * Gives the log of the demo its people and its hours. The services wrote every event in nobody's
 * name and `dated` gave each the day it stands for, so here the events of a day are laid out over
 * the office's hours in the order they happened, and the sign-ins and account changes of an office
 * are added around them.
 */
async function seedLog(db: Db, now: Date, more: (people: Record<string, number>) => Promise<(typeof auditLog.$inferInsert)[]>): Promise<void> {
  const hours = (n: number) => new Date(now.getTime() - n * 3_600_000);

  // What happened in the last day keeps its minute. Anything older happened at some hour of a working
  // day, one thing after another from the morning on.
  const placed = new Map<number, number>();
  const inOfficeHours = (at: Date): Date => {
    if (now.getTime() - at.getTime() < DAY) return at;
    const day = Math.floor((at.getTime() + RIYADH) / DAY) * DAY - RIYADH;
    const nth = placed.get(day) ?? 0;
    placed.set(day, nth + 1);
    return new Date(day + OPENING + Math.min(nth * BETWEEN, LAST));
  };

  // A day starts with people coming in, so the accounts and the sign-ins take their hour first.
  const id: Record<string, number> = {};
  const joined: Record<string, Date> = {};
  const seen: Record<string, Date> = {};
  for (const person of PEOPLE) {
    joined[person.name] = inOfficeHours(new Date(now.getTime() - person.joinedDaysAgo * DAY));
    seen[person.name] = inOfficeHours(hours(person.lastSeenHoursAgo));
    const [row] = await db
      .insert(users)
      .values({
        name: person.name,
        email: person.email,
        role: person.role,
        phone: person.phone,
        passwordHash: DECOY_HASH,
        active: person.active ?? true,
        totpEnabled: person.authenticator ?? false,
        lastLoginAt: seen[person.name],
        createdAt: joined[person.name],
        updatedAt: joined[person.name],
      })
      .returning({ id: users.id });
    id[person.name] = row!.id;
  }
  const admin = id["عبدالله"]!;
  // A passkey that opens nothing: its key is not a key. It is here so the list shows what one looks like.
  await db.insert(passkeys).values({ userId: admin, credentialId: "demo-passkey", publicKey: "demo", name: "iPhone", createdAt: joined["عبدالله"], lastUsedAt: seen["عبدالله"] });
  const stopped = inOfficeHours(hours(24 * 19 - 2));

  const written = await db.select().from(auditLog).orderBy(asc(auditLog.createdAt), asc(auditLog.id));
  type Line = typeof auditLog.$inferInsert;
  // What the people of the office did besides the deals, now that they have accounts.
  const besides = (await more(id)).map((line): Line => ({ ...line, createdAt: inOfficeHours(line.createdAt!) }));
  const about = (userId: number | null) => ({ entity: userId == null ? null : "user", entityId: userId });
  const lines: Line[] = [
    ...written.map(({ id: _, ...event }): Line => {
      const doer = doerOf(event.action, event.details);
      return { ...event, userId: doer ? id[doer]! : null, createdAt: inOfficeHours(event.createdAt) };
    }),
    ...PEOPLE.map((person): Line => ({ createdAt: joined[person.name], userId: person.name === "عبدالله" ? null : admin, action: "user.create", ...about(id[person.name]!), details: { role: person.role } })),
    { createdAt: stopped, userId: admin, action: "user.update", ...about(id["فيصل"]!), details: { changed: ["active"], active: false } },
    // Someone trying a guessed address in the night, from an address kept for examples.
    { createdAt: hours(26), userId: null, action: "login_failed", ...about(null), details: { email: "admin@masar.example" }, ip: "198.51.100.23" },
    { createdAt: hours(25.9), userId: null, action: "login_failed", ...about(null), details: { email: "admin@masar.example" }, ip: "198.51.100.23" },
    ...PEOPLE.filter((person) => person.active !== false).map((person): Line => ({ createdAt: seen[person.name], userId: id[person.name]!, action: "login", ...about(id[person.name]!), details: { method: person.method } })),
    ...besides,
  ];
  // The log is read in the order its lines were written, so it is written again in the order of time.
  // Events of one moment keep the order they came in: the sort is stable.
  lines.sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime());
  await db.delete(auditLog);
  for (let from = 0; from < lines.length; from += 50) await db.insert(auditLog).values(lines.slice(from, from + 50));
}

/** A note someone in the made-up office wrote about a lender. None of it is a fact about that lender. */
const NOTES: { by: string; daysAgo: number; lender: string; financeType: string; kind: "condition" | "exception" | "tip" | "warning"; title: string; body: string }[] = [
  { by: "منى", daysAgo: 34, lender: "البنك الأهلي السعودي", financeType: "mortgage", kind: "condition", title: "يعيد التقييم إذا تجاوز عمر العقار 20 سنة", body: "يرسل مقيّماً ثانياً، ويتأخر الرد نحو أسبوع. اطلب التقييم مبكراً." },
  { by: "خالد", daysAgo: 21, lender: "مصرف الراجحي", financeType: "personal", kind: "tip", title: "شراء المديونية أسرع من السداد ثم التقديم", body: "يحسب المديونية القائمة ضمن العرض الجديد، فلا ننتظر تحديث سمة." },
  { by: "منى", daysAgo: 8, lender: "دار التمليك", financeType: "mortgage", kind: "warning", title: "ترفع الدفعة الأولى للقطاع الخاص", body: "طلبت 20% بدل 15% في طلبين. احسب الصفقة على 80% من قيمة العقار." },
];

type Answer = "approved" | "approved_modified" | "rejected";
/** What a lender answered in the made-up office's past: [lender, kind, sector, salary, answer, expected, approved, asked, reason, days ago, note]. */
const ANSWERS: [string, "mortgage" | "personal", string, number, Answer, number, number | null, string[], string | null, number, string?][] = [
  ["البنك الأهلي السعودي", "mortgage", "gov", 16000, "approved", 990000, 990000, ["salary_transfer"], null, 71],
  ["البنك الأهلي السعودي", "personal", "gov", 16000, "approved", 240000, 240000, ["salary_transfer"], null, 70],
  ["مصرف الراجحي", "mortgage", "gov", 13000, "approved", 700000, 700000, ["salary_transfer"], null, 66],
  ["مصرف الراجحي", "personal", "gov", 13000, "approved_modified", 200000, 180000, ["salary_transfer", "buyout"], null, 64],
  ["البنك الأهلي السعودي", "mortgage", "military", 14500, "approved_modified", 820000, 760000, ["salary_transfer", "valuation"], null, 58],
  ["البنك السعودي للاستثمار", "mortgage", "gov", 11500, "approved", 610000, 610000, [], null, 51],
  ["مصرف الإنماء", "personal", "semi_gov", 12000, "rejected", 190000, null, [], "dbr", 47],
  ["البنك الأهلي السعودي", "mortgage", "private_approved", 19000, "rejected", 900000, null, [], "employer", 44],
  ["إمكان للتمويل", "personal", "private", 9000, "approved", 110000, 110000, [], null, 40],
  ["مصرف الراجحي", "mortgage", "semi_gov", 21000, "approved_modified", 1250000, 1100000, ["valuation", "down_payment"], null, 37],
  ["دار التمليك", "mortgage", "private", 15000, "approved_modified", 760000, 650000, ["down_payment", "extra_statements"], null, 33],
  ["مصرف الراجحي", "mortgage", "gov", 9800, "rejected", 480000, null, [], "simah", 25, "طلب مرور 6 أشهر على المخالصة."],
  ["البنك الأهلي السعودي", "mortgage", "gov", 12500, "approved_modified", 640000, 600000, ["medical", "salary_transfer"], null, 20],
  ["إمكان للتمويل", "personal", "gov", 7500, "approved_modified", 95000, 80000, ["simah_letter"], null, 18],
  ["النايفات للتمويل", "personal", "private", 6500, "approved", 70000, 70000, ["employer_letter"], null, 15],
  ["البنك السعودي للاستثمار", "mortgage", "retired", 9000, "approved_modified", 420000, 380000, ["shorter_tenor"], null, 12],
  ["دار التمليك", "mortgage", "private", 8500, "rejected", 400000, null, [], "income_verification", 9],
  ["بنك الرياض", "personal", "gov", 14000, "rejected", 230000, null, [], "simah", 6, "تعثر مسدد منذ شهرين."],
];

/**
 * What the made-up office knows about its lenders: a few notes of its own and the answers it got.
 * Returns the lines the notes leave in the log, for the log to place among its other events.
 */
async function seedKnowledge(db: Db, now: Date, people: Record<string, number>): Promise<(typeof auditLog.$inferInsert)[]> {
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
  const lenderId = new Map((await db.select({ id: lenders.id, name: lenders.name }).from(lenders)).map((l) => [l.name, l.id]));
  const lines: (typeof auditLog.$inferInsert)[] = [];
  for (const note of NOTES) {
    const [row] = await db
      .insert(lenderRules)
      .values({ lenderId: lenderId.get(note.lender)!, financeType: note.financeType, kind: note.kind, title: note.title, body: note.body, userId: people[note.by]!, createdAt: at(note.daysAgo) })
      .returning({ id: lenderRules.id });
    lines.push({ createdAt: at(note.daysAgo), userId: people[note.by]!, action: "lender.rule_add", entity: "rule", entityId: row!.id, details: { title: note.title, kind: note.kind, lender: note.lender } });
  }
  await db.insert(outcomes).values(
    ANSWERS.map(([lender, financeType, sector, salary, decision, estimatedAmount, approvedAmount, conditions, reason, daysAgo, note]) => ({
      lenderId: lenderId.get(lender)!,
      financeType,
      sector,
      salary,
      simah: "clean",
      decision,
      requestedAmount: estimatedAmount,
      estimatedAmount,
      approvedAmount,
      conditions,
      reason,
      note: note ?? null,
      userId: people["منى"]!,
      createdAt: at(daysAgo),
    })),
  );
  return lines;
}

/**
 * An invented project: a hotel on land its owner holds, asking for more than the build costs. Its
 * file is nearly complete, so the study reaches an answer and every part of its page has something
 * to show. No real land, owner or valuation is used.
 */
const PROJECT: { owner: string; phone: string; requested: number; openedDaysAgo: number; changedDaysAgo: number; facts: ProjectFacts } = {
  owner: "بندر",
  phone: "0500000022",
  requested: 66_000_000,
  openedDaysAgo: 9,
  changedDaysAgo: 2,
  facts: {
    ...EMPTY_PROJECT,
    borrowerType: "individual",
    city: "جدة",
    district: "أبحر الشمالية",
    landArea: 4800,
    landValue: 96_000_000,
    valuer: "مكتب تقييم معتمد",
    deed: "registered",
    projectType: "hotel",
    purpose: "build_cashout",
    constructionCost: 62_000_000,
    gfa: 21_500,
    keys: 180,
    adr: 420,
    occupancy: 64,
    equityCash: 6_000_000,
    hasFeasibility: true,
    hasPermit: true,
  },
};

/** Fills an empty database with the demo deals, dated relative to `now` so the map always looks alive. */
export async function seedDemo(db: Db, now: Date): Promise<void> {
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  await seedCatalogue(db);

  // The log takes the clock of the database, which here is the moment of seeding. After each step
  // of a deal's story, the events it wrote are moved to the time that step stands for.
  let stamped = 0;
  const dated = async (at: Date): Promise<void> => {
    const fresh = await db.select({ id: auditLog.id }).from(auditLog).where(gt(auditLog.id, stamped)).orderBy(asc(auditLog.id));
    for (const row of fresh) await db.update(auditLog).set({ createdAt: at }).where(eq(auditLog.id, row.id));
    stamped = fresh.at(-1)?.id ?? stamped;
  };
  await dated(ago(90));
  for (const demo of DEALS) {
    const [client] = await db
      .insert(clients)
      .values({
        fileNo: demo.fileNo,
        fullName: demo.name,
        phone: demo.phone,
        city: demo.city,
        employer: demo.employer,
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
    await dated(ago(demo.startedDaysAgo));
    for (const [stage, daysAgo] of demo.path) {
      await setDealStage(db, { dealId, stage, actor: SYSTEM, now: ago(daysAgo) });
      await dated(ago(daysAgo));
    }
    if (demo.credit) {
      const { report, ...rest } = demo.credit.reading((daysAgo) => riyadhDay(ago(daysAgo)));
      await addCreditReport(db, {
        clientId: client!.id,
        reading: { ...rest, report: { ...emptyReport(), ...report } },
        actor: SYSTEM,
        now: ago(demo.credit.readDaysAgo),
      });
      await dated(ago(demo.credit.readDaysAgo));
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
      await dated(at);
    }
    for (const [index, said] of (demo.thread ?? []).entries()) {
      const at = new Date(now.getTime() - said.hoursAgo * 3_600_000);
      const fileId = said.file
        ? (await db.transaction((tx) => keepFile(tx, { clientId: client!.id, code: INBOX_PAPER, name: said.file!, bytes: madeUpPdf(`${demo.fileNo} wa.${index + 1}`), actor: SYSTEM, now: at, via: "whatsapp" }))).fileId
        : null;
      await dated(at);
      await db.insert(waMessages).values({
        clientId: client!.id,
        direction: said.from === "client" ? "in" : "out",
        waId: `demo.${demo.fileNo}.${index + 1}`,
        phone: `9665000000${demo.phone.slice(-2)}`,
        type: said.file ? "document" : "text",
        body: said.body,
        fileId,
        status: said.from === "client" ? "received" : "read",
        seenAt: said.seen ? at : null,
        createdAt: at,
        updatedAt: at,
      });
    }
    if (demo.rejected) {
      await rejectDeal(db, { clientId: client!.id, reason: demo.rejected.reason, actor: SYSTEM, now: ago(demo.rejected.daysAgo) });
      await dated(ago(demo.rejected.daysAgo));
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
  // The project's file was opened before its permit came, and the permit was added when it did.
  const project = await openProject(db, {
    input: { owner: PROJECT.owner, requested: PROJECT.requested, facts: { ...PROJECT.facts, hasPermit: false, valuationDate: riyadhDay(ago(PROJECT.openedDaysAgo + 12)).replaceAll("/", "-") } },
    phone: PROJECT.phone,
    actor: SYSTEM,
    now: ago(PROJECT.openedDaysAgo),
  });
  await dated(ago(PROJECT.openedDaysAgo));
  await saveProject(db, {
    clientId: project.clientId,
    input: { owner: PROJECT.owner, requested: PROJECT.requested, facts: { ...PROJECT.facts, valuationDate: riyadhDay(ago(PROJECT.openedDaysAgo + 12)).replaceAll("/", "-") } },
    actor: SYSTEM,
    now: ago(PROJECT.changedDaysAgo),
  });
  await dated(ago(PROJECT.changedDaysAgo));
  for (const stranger of STRANGERS) {
    for (const [index, said] of stranger.said.entries()) {
      const at = new Date(now.getTime() - said.hoursAgo * 3_600_000 + index * 40_000);
      await db.insert(waMessages).values({ clientId: null, direction: "in", waId: `demo.${stranger.phone}.${index + 1}`, phone: stranger.phone, name: stranger.name, type: "text", body: said.body, status: "received", createdAt: at, updatedAt: at });
    }
  }
  await seedLog(db, now, (people) => seedKnowledge(db, now, people));
}
