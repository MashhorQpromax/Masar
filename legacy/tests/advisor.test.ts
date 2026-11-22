import { test } from "node:test";
import assert from "node:assert/strict";
import { study, aprOf, installmentFor, earlySettlement, adminFee, pensionEstimate, type Profile, type Product } from "../lib/engine.ts";
import { deepStudy } from "../lib/advisor.ts";

const personal: Product = { id: "1", lenderId: "1", lenderName: "بنك أ", lenderType: "bank", bankCode: "rajhi", financeType: "personal", name: "شخصي", minSalary: 4000, minAge: 21, maxAgeAtMaturity: 60, minServiceMonths: 3, sectors: ["gov"], nationalities: ["saudi"], maxTenor: 60, maxAmount: 1_000_000, rate: 3.5, rateType: "flat", requiresSalaryTransfer: true, acceptsLateSimah: false };
const mortgage: Product = { ...personal, id: "2", financeType: "mortgage", name: "عقاري", maxAgeAtMaturity: 75, maxTenor: 300, maxAmount: 5_000_000, rate: 5, rateType: "reducing", maxLtv: 90 };
const base: Profile = { age: 35, nationality: "saudi", sector: "gov", serviceMonths: 60, basicSalary: 10000, totalSalary: 12000, simah: "clean", financeType: "personal", obligations: [], salaryBank: "rajhi", requestedAmount: 150000, requestedTenor: 60 };

test("النسبة الثابتة 5% لخمس سنوات ≈ 9.2% فعلية", () => {
  const inst = installmentFor(100000, 60, 5, "flat");
  const apr = aprOf(100000, inst, 60);
  assert.ok(apr > 9 && apr < 9.5, String(apr));
});
test("رسوم إدارية بحد أقصى 5,000", () => {
  assert.equal(adminFee(200000), 2000);
  assert.equal(adminFee(1_000_000), 5000);
});
test("السداد المبكر: تعويض لا يتجاوز أرباح 3 أشهر", () => {
  const e = earlySettlement(100000, 6, 60, 12);
  assert.ok(e.balance > 80000 && e.balance < 85000);
  assert.ok(Math.abs(e.fee - e.balance * 0.015) < 2);
});
test("المعاش التقديري 2.5% لكل سنة", () => {
  assert.equal(pensionEstimate(10000, 30), 7500);
  assert.equal(pensionEstimate(10000, 45), 10000);
});
test("العقاري: نسبة التمويل 90% من قيمة العقار تحد المبلغ", () => {
  const p: Profile = { ...base, financeType: "mortgage", totalSalary: 30000, basicSalary: 22000, requestedAmount: null, requestedTenor: null, propertyValue: 500000, firstHome: true };
  const m = study(p, [mortgage]).matches[0];
  assert.equal(m.maxPrincipal, 450000);
  assert.match(m.limitedBy, /90%/);
});
test("المسكن الثاني 70%", () => {
  const p: Profile = { ...base, financeType: "mortgage", totalSalary: 30000, requestedAmount: null, requestedTenor: null, propertyValue: 500000, firstHome: false };
  assert.equal(study(p, [mortgage]).matches[0].maxPrincipal, 350000);
});
test("التقاعد أثناء العقاري يخفض المبلغ بقسط متدرج", () => {
  const young: Profile = { ...base, age: 30, financeType: "mortgage", requestedAmount: null, requestedTenor: 300 };
  const older: Profile = { ...young, age: 50, serviceMonths: 240 };
  const a = study(young, [mortgage]).matches[0];
  const b = study(older, [mortgage]).matches[0];
  assert.ok(b.retirement, "يجب احتساب التقاعد");
  assert.ok(b.maxPrincipal < a.maxPrincipal);
});
test("تنبيه الفحص الطبي لعمر 54 في العقاري", () => {
  const s = deepStudy({ ...base, age: 54, financeType: "mortgage", requestedAmount: 900000, requestedTenor: 300 }, [mortgage]);
  assert.ok(s.alerts.some((a) => a.id === "medical"));
});
test("مخرج سداد الالتزام يرفع المبلغ فعلياً", () => {
  const s = deepStudy({ ...base, obligations: [{ kind: "personal", lender: "بنك ب", monthly: 2000, remaining: 40000 }] }, [personal]);
  const x = s.scenarios.find((k) => k.key.startsWith("settle"));
  assert.ok(x && x.gain > 50000, JSON.stringify(s.scenarios.map((k) => [k.key, k.gain])));
});
test("المتضامن في العقاري يغطي المبلغ المطلوب", () => {
  const s = deepStudy({ ...base, financeType: "mortgage", requestedAmount: 1_500_000, requestedTenor: 300 }, [mortgage]);
  const co = s.scenarios.find((k) => k.key === "co");
  assert.ok(co && co.amount >= 1_500_000, JSON.stringify(co));
});
