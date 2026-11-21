import "server-only";
import { all, get } from "./db";
import { deepStudy } from "./advisor";
import { type Product, type Profile, type Sector, type FinanceType, type Simah, type Obligation } from "./engine";

export interface ClientRow {
  id: number;
  file_no: string;
  full_name: string;
  national_id: string | null;
  phone: string | null;
  email: string | null;
  birth_year: number | null;
  nationality: "saudi" | "non_saudi";
  marital_status: string | null;
  dependents: number | null;
  city: string | null;
  employer: string | null;
  sector: Sector;
  job_title: string | null;
  service_months: number | null;
  basic_salary: number | null;
  total_salary: number | null;
  other_income: number | null;
  salary_bank: string | null;
  simah: Simah;
  owns_home: number | null;
  housing_support: number;
  property_value: number | null;
  co_income: number | null;
  finance_type: FinanceType;
  requested_amount: number | null;
  requested_tenor: number | null;
  purpose: string | null;
  priority: string | null;
  status: string;
  eligibility: string;
  next_step: string | null;
  next_step_due: string | null;
  owner_id: number | null;
  owner_name?: string | null;
  source: string | null;
  consent_at: string | null;
  created_at: string;
  updated_at: string;
}

export function getClient(id: number) {
  return get<ClientRow>(
    "SELECT c.*, u.name AS owner_name FROM clients c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = ?",
    id,
  );
}

export function getObligations(clientId: number) {
  return all<{ id: number; kind: Obligation["kind"]; lender: string | null; monthly: number; remaining: number | null; end_date: string | null }>(
    "SELECT * FROM obligations WHERE client_id = ? ORDER BY id",
    clientId,
  );
}

interface ProductRow {
  id: number;
  lender_id: number;
  lender_name: string;
  lender_type: "bank" | "finance_company";
  bank_code: string | null;
  finance_type: FinanceType;
  name: string;
  min_salary: number;
  min_age: number;
  max_age_at_maturity: number;
  min_service_months: number;
  sectors: string;
  nationalities: string;
  max_tenor: number;
  max_amount: number;
  rate: number;
  rate_type: "flat" | "reducing";
  requires_salary_transfer: number;
  accepts_late_simah: number;
  max_ltv: number | null;
  notes: string | null;
  verified_at: string | null;
  active: number;
}

export function productRows(includeInactive = false) {
  return all<ProductRow>(
    `SELECT p.*, l.name AS lender_name, l.type AS lender_type, l.bank_code FROM products p JOIN lenders l ON l.id = p.lender_id
     ${includeInactive ? "" : "WHERE p.active = 1 AND l.active = 1"} ORDER BY l.name, p.finance_type`,
  );
}

export function products(): Product[] {
  return productRows().map((r) => ({
    id: String(r.id),
    lenderId: String(r.lender_id),
    lenderName: r.lender_name,
    lenderType: r.lender_type,
    bankCode: r.bank_code,
    financeType: r.finance_type,
    name: r.name,
    minSalary: r.min_salary,
    minAge: r.min_age,
    maxAgeAtMaturity: r.max_age_at_maturity,
    minServiceMonths: r.min_service_months,
    sectors: JSON.parse(r.sectors),
    nationalities: JSON.parse(r.nationalities),
    maxTenor: r.max_tenor,
    maxAmount: r.max_amount,
    rate: r.rate,
    rateType: r.rate_type,
    requiresSalaryTransfer: !!r.requires_salary_transfer,
    acceptsLateSimah: !!r.accepts_late_simah,
    maxLtv: r.max_ltv,
    notes: r.notes,
  }));
}

export function profileOf(c: ClientRow): Profile {
  const year = new Date().getFullYear();
  return {
    age: c.birth_year ? year - c.birth_year : null,
    nationality: c.nationality,
    sector: c.sector,
    serviceMonths: c.service_months,
    basicSalary: c.basic_salary,
    totalSalary: c.total_salary,
    otherIncome: c.other_income,
    salaryBank: c.salary_bank,
    simah: c.simah,
    housingSupport: !!c.housing_support,
    financeType: c.finance_type,
    requestedAmount: c.requested_amount,
    requestedTenor: c.requested_tenor,
    firstHome: c.owns_home == null ? null : !c.owns_home,
    propertyValue: c.property_value,
    coIncome: c.co_income,
    obligations: getObligations(c.id).map((o) => ({ kind: o.kind, lender: o.lender ?? undefined, monthly: o.monthly, remaining: o.remaining ?? undefined })),
  };
}

export function studyFor(c: ClientRow) {
  return deepStudy(profileOf(c), products());
}

export function docProgress(clientId: number) {
  const r = get<{ total: number; done: number; req: number; reqDone: number }>(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN status IN ('received','verified') THEN 1 ELSE 0 END) done,
            SUM(required) req,
            SUM(CASE WHEN required = 1 AND status IN ('received','verified') THEN 1 ELSE 0 END) reqDone
     FROM documents WHERE client_id = ?`,
    clientId,
  );
  const req = r?.req ?? 0;
  const reqDone = r?.reqDone ?? 0;
  return { total: r?.total ?? 0, done: r?.done ?? 0, required: req, requiredDone: reqDone, pct: req ? Math.round((reqDone / req) * 100) : 0 };
}

export function nextFileNo() {
  const r = get<{ n: number }>("SELECT COALESCE(MAX(CAST(SUBSTR(file_no, 3) AS INTEGER)), 0) + 1 AS n FROM clients");
  return `C-${String(r?.n ?? 1).padStart(3, "0")}`;
}

// ===== خبرة الواقع: نتائج الجهات الفعلية وملاحظات الفريق =====
export interface Experience {
  lenderId: number;
  n: number;
  approved: number;
  rejected: number;
  similarN: number;
  similarApproved: number;
  ratio: number | null; // متوسط (المعتمد ÷ تقدير المحرك)
  conditions: [string, number][];
  reasons: [string, number][];
}

export function lenderExperience(financeType: string, sector?: string, salary?: number | null): Map<number, Experience> {
  const rows = all<{ lender_id: number; decision: string; sector: string; salary: number | null; estimated_amount: number | null; approved_amount: number | null; conditions: string; reason: string | null }>(
    "SELECT lender_id, decision, sector, salary, estimated_amount, approved_amount, conditions, reason FROM outcomes WHERE finance_type = ?",
    financeType,
  );
  const m = new Map<number, Experience & { _r: number[]; _c: Record<string, number>; _x: Record<string, number> }>();
  for (const r of rows) {
    let e = m.get(r.lender_id);
    if (!e) m.set(r.lender_id, (e = { lenderId: r.lender_id, n: 0, approved: 0, rejected: 0, similarN: 0, similarApproved: 0, ratio: null, conditions: [], reasons: [], _r: [], _c: {}, _x: {} }));
    const ok = r.decision !== "rejected";
    e.n++;
    if (ok) e.approved++; else e.rejected++;
    const similar = (!sector || r.sector === sector) && (!salary || !r.salary || Math.abs(r.salary - salary) / salary <= 0.35);
    if (similar) { e.similarN++; if (ok) e.similarApproved++; }
    if (ok && r.estimated_amount && r.approved_amount) e._r.push(r.approved_amount / r.estimated_amount);
    for (const c of JSON.parse(r.conditions || "[]") as string[]) e._c[c] = (e._c[c] ?? 0) + 1;
    if (!ok && r.reason) e._x[r.reason] = (e._x[r.reason] ?? 0) + 1;
  }
  const out = new Map<number, Experience>();
  for (const [k, e] of m) {
    const { _r, _c, _x, ...rest } = e;
    out.set(k, {
      ...rest,
      ratio: _r.length ? Math.round((_r.reduce((a, b) => a + b, 0) / _r.length) * 100) / 100 : null,
      conditions: Object.entries(_c).sort((a, b) => b[1] - a[1]),
      reasons: Object.entries(_x).sort((a, b) => b[1] - a[1]),
    });
  }
  return out;
}

export interface LenderRule { id: number; lender_id: number | null; lender_name: string | null; finance_type: string | null; kind: "condition" | "exception" | "tip" | "warning"; title: string; body: string | null; author: string | null; created_at: string }
export function lenderRules(financeType?: string) {
  return all<LenderRule>(
    `SELECT r.*, l.name lender_name, u.name author FROM lender_rules r LEFT JOIN lenders l ON l.id = r.lender_id LEFT JOIN users u ON u.id = r.user_id
     WHERE r.active = 1 ${financeType ? "AND (r.finance_type IS NULL OR r.finance_type = ?)" : ""} ORDER BY r.lender_id IS NOT NULL, l.name, r.id DESC`,
    ...(financeType ? [financeType] : []),
  );
}
