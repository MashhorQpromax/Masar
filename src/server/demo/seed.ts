import "server-only";
import { defaultDealInput, type DealInput, type Stage } from "@/domain/deal";
import type { Db } from "../db/client";
import { clients } from "../db/schema";
import { saveDeal, setDealStage } from "../deals/service";
import { SYSTEM } from "../shared/actor";

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
}

const base = defaultDealInput();

/**
 * Four invented deals, one per situation the home map has to show: close to disbursement,
 * mid-way, a thin margin, and a deal that does not close. No real person or number is used.
 * Every figure on screen is computed by the real engine from these inputs.
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
  }
}
