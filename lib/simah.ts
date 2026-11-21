// تحليل تقرير سمة — دوال نقية.
// الأوزان والمهل «ممارسة سوق» تقديرية: تعثر شركة التمويل أثقل من تعثر البنك، والأحكام وإيقاف الخدمات تمنع الجميع.
// يُعدّلها فريق الائتمان من خبرته (لاحقاً من صفحة خبرة الجهات).

export type CreditorType = "bank" | "finance_company" | "telecom" | "other";
export type FacilityStatus = "current" | "late" | "default" | "settled" | "closed";

export interface Facility {
  overdue?: number | null;
  openedAt?: string | null;
  endAt?: string | null;
  lastUpdate?: string | null;
  lastPayDate?: string | null;
  defaultListedAt?: string | null;
  defaultNow?: number | null;
  defaultState?: string | null;
  lender: string;
  creditorType: CreditorType;
  product: string; // شخصي، بطاقة، سيارة، عقاري، اتصالات…
  limit?: number | null;
  balance?: number | null;
  installment?: number | null;
  status: FacilityStatus;
  worstDelay?: number | null; // أسوأ تأخر بالأيام خلال 24 شهراً (0/30/60/90/120/180…)
  lastDelayMonthsAgo?: number | null;
  defaultAmount?: number | null;
  defaultMonthsAgo?: number | null; // منذ متى سُجل التعثر
  settledMonthsAgo?: number | null; // منذ متى سُدد/سُوّي (إن سُوّي)
}

export interface Judgment {
  remaining?: number | null;
  date?: string | null;
  state?: string | null;
  decisionNo?: string | null;
  kind: "judgment" | "enforcement" | "bounced_cheque";
  creditor?: string | null;
  amount?: number | null;
  active: boolean;
  monthsAgo?: number | null;
}

export interface CreditReport {
  reportDate?: string | null;
  suspensionAssumed?: boolean;
  inquiries?: { date: string; lender: string; product: string; amount: number | null }[];
  summary?: Record<string, number | string | undefined>;
  reportMonthsAgo?: number | null;
  score?: number | null;
  facilities: Facility[];
  judgments: Judgment[];
  serviceSuspension: boolean; // إيقاف خدمات (المادة 46 من نظام التنفيذ) — من ناجز/أبشر لا من سمة
  travelBan?: boolean;
  inquiries6m?: number | null;
  inquiries12m?: number | null;
  notes?: string | null;
}

export const SIMAH_RULES = {
  weight: { bank: 1, finance_company: 1.5, telecom: 0.5, other: 0.8 } as Record<CreditorType, number>,
  // أقل مدة انتظار بعد التسوية قبل أن تقبل البنوك عادة (بالأشهر) — تقديري
  bankWaitAfterBankDefault: 12,
  bankWaitAfterFinanceCoDefault: 24,
  financeCoWaitAfterDefault: 6,
  recentDelayMonths: 12,
  manyInquiries6m: 4,
  smallDefault: 1000, // تعثر صغير (اتصالات/فواتير) قد يُتجاوز بالسداد
};

export type Access = "open" | "conditional" | "closed";
export interface CreditAnalysis {
  grade: "A" | "B" | "C" | "D" | "E";
  gradeLabel: string;
  severity: number; // 0 (ممتاز) – 100 (مغلق)
  derivedSimah: "clean" | "late" | "default";
  banks: { access: Access; reason: string; reopenInMonths: number | null };
  financeCompanies: { access: Access; reason: string; reopenInMonths: number | null };
  stats: {
    activeFacilities: number;
    totalLimits: number;
    totalBalance: number;
    monthlyInstallments: number;
    cardUtilization: number | null;
    defaults: number;
    activeDefaults: number;
    defaultsAmount: number;
    activeDefaultsAmount: number;
    bankDefaults: number;
    financeCoDefaults: number;
    telecomDefaults: number;
    judgments: number;
    activeJudgments: number;
    judgmentsAmount: number;
    bouncedCheques: number;
    worstDelay: number;
    recentDelays: number;
    inquiries6m: number;
    inquiries12m: number;
    activeJudgmentsAmount: number;
    totalToClear: number;
  };
  blockers: string[];
  findings: { level: "block" | "warn" | "info" | "good"; text: string }[];
  actions: string[];
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function analyzeCredit(r: CreditReport): CreditAnalysis {
  const R = SIMAH_RULES;
  const f = r.facilities ?? [];
  const j = r.judgments ?? [];
  const live = f.filter((x) => x.status !== "closed" && x.status !== "settled");
  const defaults = f.filter((x) => x.status === "default" || (x.status === "settled" && (x.defaultAmount ?? 0) > 0));
  const activeDefaults = f.filter((x) => x.status === "default");
  const settledDefaults = defaults.filter((x) => x.status === "settled");
  const cards = live.filter((x) => /بطاق|card/i.test(x.product) && (x.limit ?? 0) > 0);
  const cardLimit = cards.reduce((s, x) => s + (x.limit ?? 0), 0);
  const cardBal = cards.reduce((s, x) => s + (x.balance ?? 0), 0);
  const recentDelays = f.filter((x) => (x.worstDelay ?? 0) >= 30 && (x.lastDelayMonthsAgo ?? 99) <= R.recentDelayMonths).length;
  const worstDelay = Math.max(0, ...f.map((x) => x.worstDelay ?? 0));
  const jActive = j.filter((x) => x.active && x.kind !== "bounced_cheque");
  const bounced = j.filter((x) => x.kind === "bounced_cheque");
  const by = (t: CreditorType) => defaults.filter((x) => x.creditorType === t).length;

  const stats = {
    activeFacilities: live.length,
    totalLimits: live.reduce((s, x) => s + (x.limit ?? 0), 0),
    totalBalance: live.reduce((s, x) => s + (x.balance ?? 0), 0),
    monthlyInstallments: live.reduce((s, x) => s + (x.installment ?? 0), 0),
    cardUtilization: cardLimit > 0 ? Math.round((cardBal / cardLimit) * 100) : null,
    defaults: defaults.length,
    activeDefaults: activeDefaults.length,
    defaultsAmount: defaults.reduce((s, x) => s + (x.defaultAmount ?? x.balance ?? 0), 0),
    activeDefaultsAmount: activeDefaults.reduce((s, x) => s + (x.defaultNow ?? x.defaultAmount ?? x.balance ?? 0), 0),
    bankDefaults: by("bank"),
    financeCoDefaults: by("finance_company"),
    telecomDefaults: by("telecom"),
    judgments: j.filter((x) => x.kind !== "bounced_cheque").length,
    activeJudgments: jActive.length,
    judgmentsAmount: j.filter((x) => x.kind !== "bounced_cheque").reduce((s, x) => s + (x.amount ?? 0), 0),
    bouncedCheques: bounced.length,
    worstDelay,
    recentDelays,
    inquiries6m: r.inquiries6m ?? 0,
    inquiries12m: r.inquiries12m ?? 0,
    activeJudgmentsAmount: jActive.reduce((s, x) => s + (x.remaining ?? x.amount ?? 0), 0),
    totalToClear: 0,
  };
  // قرار التنفيذ غالباً هو نفس دين التعثر (الدائن رفعه للمحكمة) — لا نحسبه مرتين
  const linked = new Set<Facility>();
  for (const x of jActive) {
    const amt = x.remaining ?? x.amount ?? 0;
    const f = activeDefaults.find((d) => !linked.has(d) && Math.abs((d.defaultNow ?? d.defaultAmount ?? 0) - amt) <= Math.max(1500, amt * 0.02));
    if (f) { linked.add(f); x.creditor = x.creditor ?? f.lender; }
  }
  stats.totalToClear = Math.round(stats.activeJudgmentsAmount + activeDefaults.filter((d) => !linked.has(d)).reduce((s, d) => s + (d.defaultNow ?? d.defaultAmount ?? d.balance ?? 0), 0));

  // ===== الشدة الموزونة =====
  let sev = 0;
  for (const d of activeDefaults) sev += 30 * R.weight[d.creditorType] * ((d.defaultAmount ?? d.balance ?? 0) < R.smallDefault ? 0.4 : 1);
  for (const d of settledDefaults) {
    const age = d.settledMonthsAgo ?? 0;
    const fade = age >= 36 ? 0.2 : age >= 24 ? 0.4 : age >= 12 ? 0.6 : 1;
    sev += 14 * R.weight[d.creditorType] * fade;
  }
  sev += recentDelays * 8 + (worstDelay >= 90 ? 10 : worstDelay >= 60 ? 6 : worstDelay >= 30 ? 3 : 0);
  sev += jActive.length * 45 + (j.length - jActive.length - bounced.length) * 10 + bounced.filter((x) => x.active).length * 30;
  if (r.serviceSuspension) sev += 100;
  if ((r.inquiries6m ?? 0) >= R.manyInquiries6m) sev += 6;
  if (stats.cardUtilization != null && stats.cardUtilization > 80) sev += 5;
  sev = Math.min(100, Math.round(sev));

  const findings: CreditAnalysis["findings"] = [];
  const blockers: string[] = [];
  const actions: string[] = [];

  // ===== الموانع =====
  if (r.serviceSuspension) blockers.push(r.suspensionAssumed ? "إيقاف خدمات مرجّح (قرارات تنفيذ بحالة «عدم تنفيذ» — المادة 46) — تحقق من أبشر/ناجز. لا تقبل أي جهة قبل رفعه." : "إيقاف خدمات قائم (نظام التنفيذ) — لا تقبل أي جهة قبل رفعه.");
  if (r.travelBan) blockers.push("منع سفر مرتبط بقضية تنفيذ.");
  for (const x of jActive) blockers.push(`${x.kind === "enforcement" ? "قرار تنفيذ" : "حكم"} قائم${x.creditor ? ` (غالباً لصالح ${x.creditor})` : ""}${x.amount ? ` بمبلغ ${fmt(x.remaining ?? x.amount)}` : ""}${x.date ? ` — ${x.date}` : ""}${x.state ? ` — ${x.state}` : ""}.`);
  for (const x of bounced.filter((b) => b.active)) blockers.push(`شيك مرتجع غير مسوّى${x.amount ? ` (${fmt(x.amount)})` : ""}.`);
  for (const d of activeDefaults) blockers.push(`تعثر قائم لدى ${d.lender} (${typeLabel(d.creditorType)})${d.defaultAmount || d.balance ? ` — المتبقي ${fmt(d.defaultNow ?? d.defaultAmount ?? d.balance ?? 0)}` : ""}${d.defaultListedAt ? ` — مُدرج منذ ${d.defaultListedAt}` : ""}${d.defaultState ? ` (${d.defaultState})` : ""}${linked.has(d) ? " — مرفوع عليه قرار تنفيذ" : ""}.`);
  if (stats.totalToClear > 0) findings.push({ level: "block", text: `المطلوب سداده/تسويته لفتح الأبواب ≈ ${fmt(stats.totalToClear)} ريال (قرارات التنفيذ + التعثرات غير المرتبطة بها، دون احتساب الدين مرتين).` });

  // ===== الملاحظات =====
  if (stats.financeCoDefaults > 0)
    findings.push({ level: "warn", text: `${stats.financeCoDefaults} تعثر لدى شركات تمويل — يُقرأ أسوأ من تعثر البنك: الشركات تخدم الشريحة الأعلى مخاطرة أصلاً، فالتعثر عندها يُضعف الملف أكثر وتطول مهلة قبول البنوك (≈ ${R.bankWaitAfterFinanceCoDefault} شهراً بعد التسوية).` });
  if (stats.bankDefaults > 0) findings.push({ level: "warn", text: `${stats.bankDefaults} تعثر لدى بنوك — مهلة قبول البنوك عادة ≈ ${R.bankWaitAfterBankDefault} شهراً بعد التسوية والمخالصة.` });
  if (stats.telecomDefaults > 0) findings.push({ level: "info", text: `${stats.telecomDefaults} تعثر اتصالات/فواتير — أخف وزناً، لكن يجب سداده قبل التقديم لأن أغلب الجهات ترفض أي تعثر قائم مهما صغر.` });
  for (const d of settledDefaults) findings.push({ level: "info", text: `تعثر مسوّى لدى ${d.lender} (${typeLabel(d.creditorType)}) منذ ${d.settledMonthsAgo ?? "؟"} شهراً${d.defaultAmount ? ` — مبلغه ${fmt(d.defaultAmount)}` : ""}. يبقى ظاهراً في السجل كتاريخ.` });
  if (recentDelays > 0) findings.push({ level: "warn", text: `${recentDelays} التزام عليه تأخر 30 يوماً فأكثر خلال آخر 12 شهراً. أسوأ تأخر: ${worstDelay} يوماً.` });
  else if (worstDelay > 0) findings.push({ level: "info", text: `تأخر قديم (أسوأه ${worstDelay} يوماً) خارج آخر 12 شهراً.` });
  if ((r.inquiries6m ?? 0) >= R.manyInquiries6m) findings.push({ level: "warn", text: `${r.inquiries6m} استعلامات خلال 6 أشهر — مؤشر بحث مكثف عن تمويل؛ بعض الجهات ترفض أو تؤجل.` });
  if (stats.cardUtilization != null) findings.push({ level: stats.cardUtilization > 80 ? "warn" : "info", text: `استخدام البطاقات ${stats.cardUtilization}% من الحدود (${fmt(cardBal)} من ${fmt(cardLimit)}).` });
  if (r.score != null) findings.push({ level: r.score >= 650 ? "good" : r.score >= 550 ? "info" : "warn", text: `الدرجة الائتمانية ${r.score}.` });
  if (stats.monthlyInstallments > 0) findings.push({ level: "info", text: `أقساط شهرية قائمة في سمة: ${fmt(stats.monthlyInstallments)} ريال على ${stats.activeFacilities} التزام — تأكد أنها كلها مدخلة في الالتزامات.` });
  if (!defaults.length && !j.length && !recentDelays && !r.serviceSuspension) findings.push({ level: "good", text: "لا تعثرات ولا أحكام ولا تأخرات حديثة." });

  // ===== الوصول للجهات =====
  const lastSettled = (t: CreditorType[]) => settledDefaults.filter((d) => t.includes(d.creditorType)).reduce((m, d) => Math.min(m, d.settledMonthsAgo ?? 0), Infinity);
  const blocked = blockers.length > 0;
  let banks: CreditAnalysis["banks"];
  let fcs: CreditAnalysis["financeCompanies"];
  if (blocked) {
    banks = { access: "closed", reason: "يوجد مانع قائم", reopenInMonths: null };
    fcs = { access: "closed", reason: "يوجد مانع قائم", reopenInMonths: null };
  } else {
    const fcAge = lastSettled(["finance_company"]);
    const bankAge = lastSettled(["bank", "other"]);
    const waitFc = fcAge === Infinity ? 0 : Math.max(0, R.bankWaitAfterFinanceCoDefault - fcAge);
    const waitBank = bankAge === Infinity ? 0 : Math.max(0, R.bankWaitAfterBankDefault - bankAge);
    const wait = Math.max(waitFc, waitBank);
    if (wait > 0) banks = { access: "closed", reason: `تعثر مسوّى حديثاً${waitFc >= waitBank ? " لدى شركة تمويل" : " لدى بنك"}`, reopenInMonths: wait };
    else if (recentDelays > 0 || settledDefaults.length > 0 || (r.inquiries6m ?? 0) >= R.manyInquiries6m) banks = { access: "conditional", reason: recentDelays ? "تأخرات حديثة" : settledDefaults.length ? "تاريخ تعثر مسوّى" : "استعلامات كثيرة", reopenInMonths: null };
    else banks = { access: "open", reason: "سجل مقبول بنكياً", reopenInMonths: null };
    const anyAge = Math.min(fcAge, bankAge);
    const waitF = anyAge === Infinity ? 0 : Math.max(0, R.financeCoWaitAfterDefault - anyAge);
    fcs = waitF > 0 ? { access: "closed", reason: "تسوية حديثة جداً", reopenInMonths: waitF } : banks.access === "open" ? { access: "open", reason: "سجل مقبول", reopenInMonths: null } : { access: "conditional", reason: "تقبل بعض الشركات بخطاب تسوية وانتظام", reopenInMonths: null };
  }

  // ===== خطة العمل =====
  if (r.serviceSuspension) actions.push("حصر طلبات التنفيذ في ناجز، السداد أو التسوية مع الدائن، ثم طلب رفع الإيقاف من محكمة التنفيذ (قد يستغرق أياماً بعد السداد).");
  if (jActive.length) actions.push(`سداد أو تسوية ${jActive.length === 1 ? "قرار التنفيذ" : `قرارات التنفيذ (${jActive.length})`} بمجموع ${fmt(stats.activeJudgmentsAmount)} ريال — التفاوض على خصم مقابل سداد فوري ممكن غالباً — ثم طلب إثبات الانقضاء من ناجز.`);
  for (const d of activeDefaults.filter((x) => !linked.has(x))) actions.push(`سداد تعثر ${d.lender} (${fmt(d.defaultNow ?? d.defaultAmount ?? d.balance ?? 0)}) وطلب خطاب مخالصة.`);
  if (activeDefaults.length) actions.push("طلب تحديث سمة من كل دائن بعد السداد (عادة خلال 30 يوماً)، ثم استخراج تقرير جديد ورفعه هنا لإعادة الدراسة.");
  if (recentDelays) actions.push("انتظام كامل في كل الأقساط 6–12 شهراً قبل التقديم للبنوك.");
  if ((r.inquiries6m ?? 0) >= R.manyInquiries6m) actions.push("إيقاف أي تقديم جديد حتى تقل الاستعلامات؛ ثم تقديم متتابع لجهة واحدة في كل مرة.");
  if (stats.cardUtilization != null && stats.cardUtilization > 70) actions.push("خفض رصيد البطاقات تحت 30–50% من الحد أو إلغاء غير المستخدم.");
  if (banks.reopenInMonths) actions.push(`إعادة الدراسة للبنوك بعد ≈ ${banks.reopenInMonths} شهراً من الآن.`);
  if (!actions.length) actions.push("لا إجراء مطلوب على السجل الائتماني.");

  const grade: CreditAnalysis["grade"] = blocked ? "E" : sev >= 60 ? "D" : sev >= 35 ? "C" : sev >= 12 ? "B" : "A";
  const gradeLabel = { A: "ممتاز — مقبول لدى الجميع", B: "جيد — مقبول مع ملاحظات", C: "ضعيف — شركات التمويل غالباً", D: "سيئ — يحتاج معالجة قبل أي تقديم", E: "مغلق — مانع قائم" }[grade];
  const derivedSimah = activeDefaults.length || jActive.length || r.serviceSuspension ? "default" : recentDelays || settledDefaults.some((d) => (d.settledMonthsAgo ?? 0) < 24) ? "late" : "clean";

  return { grade, gradeLabel, severity: sev, derivedSimah, banks, financeCompanies: fcs, stats, blockers, findings, actions };
}

export function typeLabel(t: CreditorType) {
  return { bank: "بنك", finance_company: "شركة تمويل", telecom: "اتصالات/خدمات", other: "أخرى" }[t];
}

export function emptyReport(): CreditReport {
  return { facilities: [], judgments: [], serviceSuspension: false, inquiries6m: null, inquiries12m: null, score: null };
}

/** قراءة مبدئية لنص تقرير سمة المستخرج من PDF — تملأ ما تستطيع ويُكمل المحلل الباقي */
export function parseSimahText(text: string): Partial<CreditReport> & { found: string[] } {
  const t = text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\s+/g, " ");
  const found: string[] = [];
  const out: Partial<CreditReport> & { found: string[] } = { found };
  const score = t.match(/(?:score|الدرجة|النتيجة|التقييم)\D{0,30}([3-9]\d{2})\b/i);
  if (score) { out.score = Number(score[1]); found.push(`الدرجة ${score[1]}`); }
  const inq = t.match(/(?:enquir|inquir|استعلام)\D{0,40}(\d{1,2})\b/i);
  if (inq) { out.inquiries6m = Number(inq[1]); found.push(`استعلامات ${inq[1]}`); }
  if (/إيقاف\s*خدمات|service\s*suspension/i.test(t)) { out.serviceSuspension = true; found.push("ذِكر إيقاف خدمات"); }
  const defaults = t.match(/(?:default|متعثر|تعثر)/gi);
  if (defaults) found.push(`ذُكر التعثر ${defaults.length} مرة — راجع الجدول`);
  const judg = t.match(/(?:judg|حكم|أحكام|تنفيذ)/gi);
  if (judg) found.push(`ذُكرت أحكام/تنفيذ ${judg.length} مرة — راجع`);
  return out;
}
