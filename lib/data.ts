import "server-only";
import { all, get } from "./db";
import { deepStudy } from "./advisor";
import { analyzeCredit, type CreditReport } from "./simah";
import { projectStudy, type ProjectInput } from "./project";
import type { WaContext } from "./whatsapp";
import { FINANCE_TYPE, BANKS } from "./labels";
import { dealStudy, defaultInput, normFee, itemsFrom, type DealInput, type Borrower, type Stage } from "./deal";
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
  extra: string | null;
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

export async function getClient(id: number) {
  return await get<ClientRow>(
    "SELECT c.*, u.name AS owner_name FROM clients c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = ?",
    id,
  );
}

export async function getObligations(clientId: number) {
  return await all<{ id: number; kind: Obligation["kind"]; lender: string | null; monthly: number; remaining: number | null; end_date: string | null }>(
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

export async function productRows(includeInactive = false) {
  return await all<ProductRow>(
    `SELECT p.*, l.name AS lender_name, l.type AS lender_type, l.bank_code FROM products p JOIN lenders l ON l.id = p.lender_id
     ${includeInactive ? "" : "WHERE p.active = 1 AND l.active = 1"} ORDER BY l.name, p.finance_type`,
  );
}

export async function products(): Promise<Product[]> {
  return (await productRows()).map((r) => ({
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

export async function profileOf(c: ClientRow): Promise<Profile> {
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
    obligations: (await getObligations(c.id)).map((o) => ({ kind: o.kind, lender: o.lender ?? undefined, monthly: o.monthly, remaining: o.remaining ?? undefined })),
  };
}

export async function latestCredit(clientId: number) {
  const r = await get<{ id: number; report: string; created_at: string; doc_id: number | null; author: string | null }>(
    "SELECT r.id, r.report, r.created_at, r.doc_id, u.name author FROM credit_reports r LEFT JOIN users u ON u.id = r.user_id WHERE r.client_id = ? ORDER BY r.id DESC LIMIT 1",
    clientId,
  );
  if (!r) return null;
  const report = JSON.parse(r.report) as CreditReport & { warnings?: string[]; confidence?: string };
  return { id: r.id, createdAt: r.created_at, author: r.author, docId: r.doc_id, report, analysis: analyzeCredit(report) };
}

export function projectFor(c: ClientRow) {
  if (c.finance_type !== "project") return null;
  let x: ProjectInput = {};
  try { x = c.extra ? JSON.parse(c.extra) : {}; } catch {}
  return { input: x, study: projectStudy(x, c.requested_amount ?? 0) };
}

const PJ_VERDICT = { feasible: "eligible", feasible_restructure: "conditional", needs_info: "pending", weak: "not_eligible" } as const;

export async function studyFor(c: ClientRow) {
  const cr = await latestCredit(c.id);
  const s = deepStudy(await profileOf(c), await products(), cr?.analysis ?? null);
  const pj = projectFor(c);
  if (pj && s.verdict !== "not_eligible") return { ...s, verdict: PJ_VERDICT[pj.study.verdict], headline: pj.study.headline };
  return s;
}

export async function docProgress(clientId: number) {
  const r = await get<{ total: number; done: number; req: number; reqDone: number }>(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN status IN ('received','verified') THEN 1 ELSE 0 END) done,
            SUM(required) req,
            SUM(CASE WHEN required = 1 AND status IN ('received','verified') THEN 1 ELSE 0 END) "reqDone"
     FROM documents WHERE client_id = ?`,
    clientId,
  );
  const req = r?.req ?? 0;
  const reqDone = r?.reqDone ?? 0;
  return { total: r?.total ?? 0, done: r?.done ?? 0, required: req, requiredDone: reqDone, pct: req ? Math.round((reqDone / req) * 100) : 0 };
}

export async function nextFileNo() {
  const r = await get<{ n: number }>("SELECT COALESCE(MAX(CAST(SUBSTR(file_no, 3) AS INTEGER)), 0) + 1 AS n FROM clients");
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

export async function lenderExperience(financeType: string, sector?: string, salary?: number | null): Promise<Map<number, Experience>> {
  const rows = await all<{ lender_id: number; decision: string; sector: string; salary: number | null; estimated_amount: number | null; approved_amount: number | null; conditions: string; reason: string | null }>(
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
export async function lenderRules(financeType?: string) {
  return await all<LenderRule>(
    `SELECT r.*, l.name lender_name, u.name author FROM lender_rules r LEFT JOIN lenders l ON l.id = r.lender_id LEFT JOIN users u ON u.id = r.user_id
     WHERE r.active = 1 ${financeType ? "AND (r.finance_type IS NULL OR r.finance_type = ?)" : ""} ORDER BY r.lender_id IS NOT NULL, l.name, r.id DESC`,
    ...(financeType ? [financeType] : []),
  );
}

/** تقدّم المستندات لعدة عملاء باستعلام واحد */
export async function docProgressMap(ids: number[]) {
  const m = new Map<number, { pct: number; required: number; requiredDone: number }>();
  if (!ids.length) return m;
  const rows = await all<{ client_id: number; req: number; reqDone: number }>(
    `SELECT client_id, SUM(required) req, SUM(CASE WHEN required = 1 AND status IN ('received','verified') THEN 1 ELSE 0 END) "reqDone"
     FROM documents WHERE client_id IN (${ids.map(() => "?").join(",")}) GROUP BY client_id`,
    ...ids,
  );
  for (const r of rows) m.set(r.client_id, { required: r.req ?? 0, requiredDone: r.reqDone ?? 0, pct: r.req ? Math.round(((r.reqDone ?? 0) / r.req) * 100) : 0 });
  return m;
}

// ===== صفقة السداد وإعادة التمويل =====
export function borrowerOf(c: ClientRow): Borrower {
  return { age: c.birth_year ? new Date().getFullYear() - c.birth_year : null, basicSalary: c.basic_salary, totalSalary: c.total_salary, serviceMonths: c.service_months, sector: c.sector };
}
export async function dealFor(c: ClientRow) {
  const row = await get<{ id: number; stage: Stage; data: string; stage_log: string; updated_at: string }>("SELECT id, stage, data, stage_log, updated_at FROM deals WHERE client_id = ?", c.id);
  const cr = await latestCredit(c.id);
  let input: DealInput;
  if (row) { const raw = JSON.parse(row.data) as Partial<DealInput>; input = { ...defaultInput(), ...raw, fee: normFee(raw.fee) }; }
  else {
    input = { ...defaultInput(), items: itemsFrom(cr?.report ?? null, await getObligations(c.id)), propertyValue: c.property_value ?? null, targetBank: c.salary_bank ?? null };
  }
  const credit = cr ? { bankReopenMonths: cr.analysis.banks.reopenInMonths, suspension: !!cr.report.serviceSuspension, financeCoDefault: cr.analysis.stats.financeCoDefaults > 0 } : null;
  return {
    saved: !!row,
    stage: (row?.stage ?? "study") as Stage,
    log: row ? (JSON.parse(row.stage_log) as { stage: Stage; at: string; by: string; note?: string }[]) : [],
    updatedAt: row?.updated_at ?? null,
    input,
    credit,
    borrower: borrowerOf(c),
    study: dealStudy(input, borrowerOf(c), credit),
  };
}

// ===== واتساب ورابط العميل =====
export async function missingDocs(clientId: number) {
  return await all<{ id: number; code: string; label: string; status: string; required: number }>(
    "SELECT id, code, label, status, required FROM documents WHERE client_id = ? AND required = 1 AND status IN ('missing','rejected') ORDER BY id", clientId,
  );
}
export async function activeShareLink(clientId: number) {
  return await get<{ token: string; expires_at: string; views: number; last_view_at: string | null }>(
    "SELECT token, expires_at, views, last_view_at FROM share_links WHERE client_id = ? AND revoked = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1", clientId,
  );
}
// الأهم أولاً (الصك والتقييم يحددان التمويل)، وبدون تكرار
const DOC_FIRST = ["deed", "valuation", "feasibility", "permit", "boq", "sources_uses", "id", "salary_cert"];
function dedupeDocs(rows: { label: string; code?: string }[]) {
  const seen = new Set<string>();
  const rank = (c?: string) => { const i = DOC_FIRST.indexOf(c ?? ""); return i < 0 ? 99 : i; };
  return [...rows].sort((a, b) => rank(a.code) - rank(b.code))
    .filter((r) => { const k = r.label.trim(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((r) => ({ label: r.label }));
}

export async function waContextFor(c: ClientRow, staffName: string, link: string | null, linkDays = 14): Promise<WaContext> {
  const cr = await latestCredit(c.id);
  const deal = c.finance_type === "project" ? null : await dealFor(c);
  const pj = projectFor(c);
  const items = deal?.input.items ?? [];
  const ex = items.filter((i) => i.kind === "execution"), df = items.filter((i) => i.kind === "default");
  const st = cr?.analysis.stats;
  const credit = deal?.saved
    ? { executions: ex.length, executionsAmount: ex.reduce((a, i) => a + i.original, 0), defaults: df.length, defaultsAmount: df.reduce((a, i) => a + i.original, 0), suspension: deal.credit?.suspension ?? false }
    : st ? { executions: st.activeJudgments, executionsAmount: st.activeJudgmentsAmount, defaults: st.activeDefaults, defaultsAmount: st.activeDefaultsAmount, suspension: !!cr?.report.serviceSuspension } : null;
  const s = await studyFor(c);
  const d = deal?.saved ? deal.study : null;
  const payoff = items.filter((i) => i.kind === "mortgage_payoff" || i.kind === "personal_payoff");
  // أفضل عرض: الموافقة أولاً، ثم الأقرب للموافقة، ثم الأكبر مبلغاً
  const offers = await all<{ lender: string | null; lender_type: string | null; product_name: string | null; amount: number; tenor: number | null; status: string }>(
    "SELECT l.name lender, l.type lender_type, a.product_name, a.amount, a.tenor, a.status FROM applications a LEFT JOIN lenders l ON l.id = a.lender_id WHERE a.client_id = ? AND a.amount > 0 AND a.status NOT IN ('rejected','withdrawn')", c.id);
  const RANK: Record<string, number> = { disbursed: 0, approved: 1, more_info: 2, under_review: 3, submitted: 4, draft: 5 };
  const best = offers.sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || b.amount - a.amount)[0];
  return {
    rejected: c.status === "rejected" || deal?.stage === "lost",
    offer: best ? { lender: best.lender ?? best.product_name ?? "جهة تمويلية", lenderType: best.lender_type ?? "", product: best.lender ? best.product_name : null, amount: best.amount, tenor: best.tenor, status: best.status } : null,
    // اسم مؤقت مثل «عميل المسوّق — …» لا يُستخدم في التحية
    firstName: /^(عميل|client)(\s|$)/i.test(c.full_name.trim()) || c.full_name.includes("—") ? "" : c.full_name.split(" ")[0],
    fullName: c.full_name,
    fileNo: c.file_no,
    staffName: staffName.split(" ")[0],
    financeLabel: FINANCE_TYPE[c.finance_type as keyof typeof FINANCE_TYPE] ?? "",
    isProject: c.finance_type === "project",
    projectHeadline: pj?.study.headline ?? null,
    salary: c.total_salary,
    currentDbr: s.capacity.currentDbr,
    credit,
    deal: d && deal ? {
      stage: deal.stage, verdict: d.verdict,
      settleTotal: items.filter((i) => i.by === "company" && (i.kind === "execution" || i.kind === "default" || i.kind === "card" || i.kind === "other")).reduce((a, i) => a + i.pay, 0),
      payoffTotal: payoff.reduce((a, i) => a + i.pay, 0),
      payoffLenders: [...new Set(payoff.map((i) => i.label.split("—")[1]?.trim()).filter(Boolean) as string[])],
      mortgage: d.financing.mortgage, personal: d.financing.personal, clientNet: d.clientNet,
      bankName: deal.input.targetBank ? BANKS[deal.input.targetBank] ?? null : null,
      capital: d.capital, fee: d.fee, feeSettle: d.feeSettle, feeFinance: d.feeFinance, roi: d.roi, cover: d.cover, days: d.days,
      risks: d.risks.filter((r) => r.level !== "info").map((r) => r.text), breakEvenDiscount: d.breakEvenDiscount,
    } : null,
    missingDocs: dedupeDocs(await missingDocs(c.id)),
    link,
    linkDays,
  };
}
