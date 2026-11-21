import "server-only";
import { all, get } from "./db";
import { study, type Product, type Profile, type Sector, type FinanceType, type Simah, type Obligation } from "./engine";

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
    obligations: getObligations(c.id).map((o) => ({ kind: o.kind, lender: o.lender ?? undefined, monthly: o.monthly, remaining: o.remaining ?? undefined })),
  };
}

export function studyFor(c: ClientRow) {
  return study(profileOf(c), products());
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
