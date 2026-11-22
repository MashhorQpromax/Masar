import "server-only";
import { emptyReport, type CreditReport, type ParsedReport } from "@/domain/credit";
import { defaultDealInput, type DealInput, type Stage } from "@/domain/deal";
import { addCreditReport } from "../credit/service";
import type { Db } from "../db/client";
import { clients } from "../db/schema";
import { saveDeal, setDealStage } from "../deals/service";
import { SYSTEM } from "../shared/actor";
import { riyadhDay } from "../shared/clock";

const DAY = 24 * 60 * 60 * 1000;

interface DemoDeal {
  fileNo: string;
  name: string;
  birthYear: number;
  basicSalary: number;
  totalSalary: number;
  serviceMonths: number;
  input: DealInput;
  /** Stages the deal has entered after the study, with how many days ago each one started. */
  path: [Stage, number][];
  /** Days since the study started. */
  startedDaysAgo: number;
  /** The client's SIMAH record as it was read, when one was. `day` gives the date that many days ago. */
  credit?: { readDaysAgo: number; reading: (day: (daysAgo: number) => string) => DemoReading };
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
 */
const DEALS: DemoDeal[] = [
  {
    fileNo: "C-019",
    name: "فهد",
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
  },
  {
    fileNo: "C-014",
    name: "سالم",
    birthYear: 1989,
    basicSalary: 11000,
    totalSalary: 15200,
    serviceMonths: 150,
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
    birthYear: 1981,
    basicSalary: 10500,
    totalSalary: 14100,
    serviceMonths: 230,
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
  for (const demo of DEALS) {
    const [client] = await db
      .insert(clients)
      .values({
        fileNo: demo.fileNo,
        fullName: demo.name,
        birthYear: demo.birthYear,
        basicSalary: demo.basicSalary,
        totalSalary: demo.totalSalary,
        serviceMonths: demo.serviceMonths,
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
  }
}
