import { test } from "node:test";
import assert from "node:assert/strict";
import { capacity, study, principalFrom, installmentFor, type Profile, type Product } from "../lib/engine.ts";

const base: Profile = { age: 35, nationality: "saudi", sector: "gov", serviceMonths: 60, basicSalary: 10000, totalSalary: 12000, simah: "clean", financeType: "personal", obligations: [], salaryBank: "rajhi", requestedAmount: 150000, requestedTenor: 60 };
const prod: Product = { id: "1", lenderId: "1", lenderName: "بنك أ", lenderType: "bank", bankCode: "rajhi", financeType: "personal", name: "شخصي", minSalary: 4000, minAge: 21, maxAgeAtMaturity: 60, minServiceMonths: 3, sectors: ["gov"], nationalities: ["saudi"], maxTenor: 60, maxAmount: 1_000_000, rate: 3.5, rateType: "flat", requiresSalaryTransfer: true, acceptsLateSimah: false };

test("33.33% من الراتب الإجمالي للموظف", () => {
  const c = capacity(base);
  assert.equal(c.available, 4000);
});
test("25% للمتقاعد", () => {
  const c = capacity({ ...base, sector: "retired", totalSalary: 8000 });
  assert.equal(c.available, 2000);
});
test("الالتزامات القائمة تخصم", () => {
  assert.equal(capacity({ ...base, obligations: [{ kind: "card", monthly: 1000 }] }).available, 3000);
});
test("العقاري: 55% حتى 15 ألف ويشمل كل الالتزامات", () => {
  const c = capacity({ ...base, financeType: "mortgage", obligations: [{ kind: "personal", monthly: 2000 }] });
  assert.equal(c.available, 4600);
});
test("العقاري: 65% لمستفيد الإسكان", () => {
  assert.equal(capacity({ ...base, financeType: "mortgage", housingSupport: true }).available, 7800);
});
test("الاستهلاكي مع قسط عقاري قائم والسقف الكلي يحكم", () => {
  // دخل 12,000: 33.33% = 4000، السقف الكلي 55% = 6600 - عقاري 4000 = 2600
  const c = capacity({ ...base, obligations: [{ kind: "mortgage", monthly: 4000 }] });
  assert.equal(c.available, 2600);
});
test("الصيغ عكسية", () => {
  const p = principalFrom(4000, 60, 3.5, "flat");
  assert.ok(Math.abs(installmentFor(p, 60, 3.5, "flat") - 4000) < 0.01);
  const m = principalFrom(5000, 300, 5, "reducing");
  assert.ok(Math.abs(installmentFor(m, 300, 5, "reducing") - 5000) < 0.01);
});
test("المدة تقصر حسب العمر", () => {
  const s = study({ ...base, age: 57 }, [prod]);
  assert.equal(s.matches[0].tenor, 36);
});
test("حكم مؤهل", () => {
  const s = study(base, [prod]);
  assert.equal(s.verdict, "eligible");
  assert.equal(s.matches[0].offerPrincipal, 150000);
});
test("متعثر = غير مؤهل", () => {
  assert.equal(study({ ...base, simah: "default" }, [prod]).verdict, "not_eligible");
});
