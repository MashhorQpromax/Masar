// قراءة تقرير سمة (التقرير الائتماني الأساسي — PDF) آلياً.
// pdf.js يخرج النص العربي معكوس الحروف والأرقام ملتصقة، لذا:
// - نطابق العبارات العربية بصيغتها المعكوسة R("...")
// - نفصل الأرقام بنمطها الثابت في سمة: المبالغ بخانتين عشريتين، والتواريخ yyyy/mm/dd
// النتيجة "مسودة" يراجعها المحلل قبل الاعتماد.
import type { CreditReport, CreditorType, Facility, FacilityStatus, Judgment } from "./simah.ts";

const R = (s: string) => [...s].reverse().join("");
const AMT = /\d+\.\d{2}/g;
const DATE = /\d{4}\/\d{2}\/\d{2}/g;

export interface ParsedSimah {
  report: CreditReport;
  reportDate: string | null;
  summary: { activeCount?: number; totalLimits?: number; totalOutstanding?: number; defaultedCount?: number; defaultedRemaining?: number; firstProductDate?: string };
  inquiries: { date: string; lender: string; product: string; amount: number | null }[];
  warnings: string[];
  confidence: "high" | "medium" | "low";
}


export function creditorTypeOf(lender: string, product = ""): CreditorType {
  if (/الهاتف|اتصالات|موبايلي|زين|سلام|ليبارا|فيرجن|الإنترنت/.test(lender + " " + product)) return "telecom";
  if (/بنك|مصرف|الراجحي|الإنماء|البلاد|الجزيرة|ساب/.test(lender)) return "bank";
  if (/تمويل|المالية|للتمويل|إمكان|امكان|النايفات|تمارا|تابي|كوارا|اليسر|الأولى|تأجير|تساهيل|سهل/.test(lender)) return "finance_company";
  return "other";
}

function monthsBetween(a: string, b: string) {
  const [y1, m1] = a.split("/").map(Number);
  const [y2, m2] = b.split("/").map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1));
}

// أسماء الجهات المعروفة — النص المستخرج يبعثر "ال" و"ت" فنتعرف عليها بكلمات مفتاحية
const KNOWN_LENDERS: [RegExp, string][] = [
  [/أهلي|األهلي|يلهلأا|الهلي/, "البنك الأهلي السعودي"],
  [/راجحي|يحجارلا/, "مصرف الراجحي"],
  [/الرياض|ضايرلا/, "بنك الرياض"],
  [/الإنماء|اإلنماء|ءامنإلا|انماء/, "مصرف الإنماء"],
  [/البلاد|دالبلا|البالد/, "بنك البلاد"],
  [/الجزيرة|ةريزجلا/, "بنك الجزيرة"],
  [/للاستثمار|لالستثمار|رامثتسالل/, "البنك السعودي للاستثمار"],
  [/الفرنسي|يسنرفلا/, "البنك السعودي الفرنسي"],
  [/العربي الوطني|العربي/, "البنك العربي الوطني"],
  [/ساب|الأول/, "البنك السعودي الأول (ساب)"],
  [/المتحدة|ةدحتملا/, "الشركة المتحدة للخدمات المالية"],
  [/إمكان|امكان|ناكمإ/, "إمكان للتمويل"],
  [/النايفات|تافيانلا/, "النايفات للتمويل"],
  [/تمارا|راامت|اراامت/, "تمارا"],
  [/تابي|يبات/, "تابي"],
  [/كوارا|اراوك/, "كوارا للتمويل"],
  [/جميل|ليمج/, "عبداللطيف جميل للتمويل"],
  [/اليسر|رسيلا/, "اليسر للتمويل"],
  [/موبايلي|يليابوم/, "موبايلي"],
  [/زين|نيز/, "زين"],
  [/تصا|اصتلا|اتصاالت|التصا/, "الاتصالات السعودية (STC)"],
];
function canonLender(s: string) {
  for (const [re, name] of KNOWN_LENDERS) if (re.test(s)) return name;
  return s.replace(/\s+/g, " ").trim();
}
function productOf(s: string) {
  if (/جو[اﻻ]?ل|جولا|الجوال/.test(s)) return "الهاتف الجوال";
  if (/ثابت/.test(s)) return "الهاتف الثابت";
  if (/منزلي|عقاري/.test(s)) return "تمويل منزلي";
  if (/بطاقة/.test(s)) return "بطاقة ائتمان";
  if (/تأجير|تاجير/.test(s)) return "عقد تأجير";
  if (/سيارة/.test(s)) return "تمويل سيارة";
  if (/شخصي/.test(s)) return "قرض شخصي";
  if (/منتجات|ادفع/.test(s)) return "تمويل منتجات/اشتر الآن";
  return "منتج";
}

/** يفصل "نوع المنتج + الجهة" الملتصقين في عنوان المنتج */
function splitTypeLender(s: string) {
  return { product: productOf(s), lender: canonLender(s) };
}

export function parseSimahPages(pagesIn: string[]): ParsedSimah {
  const pages = pagesIn.map((p) => p.normalize("NFKC").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
  const all = pages.join("\n");
  const lines = all.split("\n").map((l) => l.trim()).filter(Boolean);
  const warnings: string[] = [];

  // ===== تاريخ التقرير =====
  const rd = all.match(/\d{2}:\d{2}:\d{2}\s*-\s*(\d{4}\/\d{2}\/\d{2})/);
  const reportDate = rd ? rd[1] : null;
  const ref = reportDate ?? new Date().toISOString().slice(0, 10).replace(/-/g, "/");

  // ===== الملخص العام =====
  const summary: ParsedSimah["summary"] = {};
  for (const l of lines) {
    const n = l.match(/^(\d+(?:\.\d{2})?)\s*/);
    if (!n) continue;
    const v = Number(n[1]);
    // نص سمة المستخرج يبعثر بعض الحروف، فنطابق أجزاء ثابتة من العبارات (معكوسة)
    const has = (w: string) => l.includes(w);
    if (has("ةلوفكملا")) continue;
    if (has("ةطشنلا") && has("ادع") && Number.isInteger(v)) summary.activeCount = v;
    else if (has("رثعتملا") && has("يقبتملا")) summary.defaultedRemaining = v;
    else if (has("رثعتملا") && has("ادع") && Number.isInteger(v)) summary.defaultedCount = v;
    else if (has("ادحلا") && has("يلامجإ")) summary.totalLimits = v;
    else if (has("ةمئاقلا") && has("يلامجإ")) summary.totalOutstanding = v;
  }
  const fp = all.match(/(\d{4}\/\d{2}\/\d{2})\s*:\s*[^\n]*?جتنم/);
  if (fp) summary.firstProductDate = fp[1];

  // ===== تفاصيل المنتجات (كتلة لكل منتج) =====
  const facilities: Facility[] = [];
  const HEAD = R("حالة المنتج");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.includes(HEAD) || !l.includes(":جتنملا")) continue;
    const st: FacilityStatus = l.includes(R("منتج متعثر")) ? "default" : l.includes(R("منتج مغلق")) ? "closed" : "current";
    const { product, lender } = splitTypeLender(R(l));
    // الأسطر التالية حتى العنوان التالي
    let issue: string | null = null, limit: number | null = null, end: string | null = null;
    let balance: number | null = null, overdue: number | null = null, lastUpdate: string | null = null, lastPayDate: string | null = null;
    let installment: number | null = null;
    for (let k = i + 1; k < Math.min(lines.length, i + 140); k++) {
      const x = lines[k];
      if (x.includes(HEAD)) break;
      // سطر: تاريخ الإصدار + الحد + عدد الأقساط ومبلغ القسط ملتصقان + شهري + تاريخ الانتهاء
      const m1 = x.match(/^(\d{4}\/\d{2}\/\d{2})(\d+\.\d{2})\d*?(?:\.\d{2})?\s*/);
      if (!issue && m1 && x.includes(R("شهري"))) {
        issue = m1[1];
        limit = Number(m1[2]);
        const e = x.match(new RegExp(R("شهري") + "(\\d{4}\\/\\d{2}\\/\\d{2})"));
        end = e ? e[1] : null;
        continue;
      }
      // سطر: المتبقي + المتأخر + تاريخ التحديث + مبلغ آخر سداد + تاريخه + الاستحقاق القادم + ضمان تحويل الراتب
      const m2 = x.match(/^(\d+\.\d{2})(\d+\.\d{2})(\d{4}\/\d{2}\/\d{2})/);
      if (balance == null && m2 && /(معن|لا)$/.test(x)) {
        balance = Number(m2[1]);
        overdue = Number(m2[2]);
        lastUpdate = m2[3];
        const ds = x.match(DATE) ?? [];
        lastPayDate = ds[1] ?? null;
        continue;
      }
      // سطر: الدفعة الأخيرة + المقدمة + المبلغ الممول + الحد الأعلى للقسط + طبيعة العقد + الحالة + متوسط القسط
      if (installment == null && /^\d+\.\d{2}\d+\.\d{2}\d+\.\d{2}\d+\.\d{2}/.test(x)) {
        const a = x.match(AMT) ?? [];
        installment = Number(a[3] ?? 0) || Number(a[a.length - 1] ?? 0) || 0;
      }
    }
    const f: Facility = {
      lender: lender || "غير محدد",
      creditorType: creditorTypeOf(lender, product),
      product,
      limit,
      balance: st === "closed" ? 0 : balance,
      installment: st === "current" ? installment : 0,
      status: st === "current" && (overdue ?? 0) > 0 ? "late" : st,
      overdue,
      openedAt: issue,
      endAt: end,
      lastUpdate,
      lastPayDate,
    };
    if (st === "default") {
      f.defaultAmount = balance;
      f.defaultMonthsAgo = lastUpdate ? monthsBetween(lastUpdate, ref) : null;
    }
    facilities.push(f);
  }

  // ===== جدول المنتجات المتعثرة (يحوي تاريخ الإدراج والمبلغ الحالي وحالة التعثر) =====
  for (const l of lines) {
    const m = l.match(/(\d{4}\/\d{2}\/\d{2})(\d+\.\d{2})(\d+\.\d{2})(.*)$/);
    if (!m) continue;
    const tail = R(m[4]);
    if (!/مدفوع|غير مدفوع/.test(tail)) continue;
    const listed = m[1], amount = Number(m[2]), now = Number(m[3]);
    const settled = /مدفوع بالكامل/.test(tail);
    // نطابقه بالمنتج المتعثر ذي نفس المبلغ
    const f = facilities.find((x) => (x.status === "default" || x.status === "closed") && x.balance != null && (Math.abs((x.defaultAmount ?? x.balance) - amount) < 1 || Math.abs((x.balance ?? 0) - now) < 1));
    const settleDate = l.match(/(\d{4}\/\d{2}\/\d{2})\s*$/)?.[1] ?? (R(l).match(/^(\d{2}\/\d{2}\/\d{4})/)?.[1] ? null : null);
    if (f) {
      f.defaultAmount = amount;
      f.defaultListedAt = listed;
      f.defaultMonthsAgo = monthsBetween(listed, ref);
      f.defaultNow = settled ? 0 : now;
      f.defaultState = tail.replace(/[\d/]/g, "").trim();
      if (settled) { f.status = "settled"; f.settledMonthsAgo = settleDate ? monthsBetween(settleDate, ref) : null; }
    } else {
      facilities.push({
        lender: "غير محدد (من جدول المتعثرات)", creditorType: "other", product: "منتج متعثر", status: settled ? "settled" : "default",
        defaultAmount: amount, defaultNow: settled ? 0 : now, defaultListedAt: listed, defaultMonthsAgo: monthsBetween(listed, ref), defaultState: tail.replace(/[\d/]/g, "").trim(),
      });
      warnings.push(`تعثر بمبلغ ${amount} لم يُطابق بمنتج — راجع الجهة يدوياً.`);
    }
  }

  // ===== قرارات محاكم التنفيذ =====
  const judgments: Judgment[] = [];
  const EXEC = R("تنفيذ");
  for (const l of lines) {
    if (!l.includes(EXEC)) continue;
    const m = l.match(/(\d{4}\/\d{2}\/\d{2})(\d+\.\d{2})(\d+\.\d{2})(.*)$/);
    if (!m) continue;
    const state = R(m[4]).trim();
    const active = /عدم تنفيذ|قائم|جاري/.test(state) || !/منفذ|تم التنفيذ|مسدد|منتهي|مغلق/.test(state);
    const no = l.match(/^\d{4}\/\d{2}\/\d{2}(\d{8,})/)?.[1] ?? null;
    judgments.push({ kind: "enforcement", amount: Number(m[2]), remaining: Number(m[3]), active, monthsAgo: monthsBetween(m[1], ref), date: m[1], state, decisionNo: no, creditor: null });
  }

  // ===== الشيكات المرتجعة =====
  // (تُقرأ إن وُجدت بنفس النمط: تاريخ + مبلغ + متبقي + حالة الشيك)

  // ===== الاستعلامات =====
  const inquiries: ParsedSimah["inquiries"] = [];
  let inInq = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!inInq && l.includes(R("المستعلم"))) { inInq = true; continue; }
    if (inInq && (l.includes("اررقلا") || l.includes("رارقلا") || l.includes(R("تنفيذ")))) break;
    if (!inInq) continue;
    const m = l.match(/^(\d{4}\/\d{2}\/\d{2})(.*)$/);
    if (!m) continue;
    let rest = m[2];
    // المبلغ في نهاية السطر أو في سطر لاحق
    let amount: number | null = null;
    const a = rest.match(/(\d+\.\d{2})$/);
    let tailLine = "";
    if (a) amount = Number(a[1]);
    else for (let k = i + 1; k < Math.min(lines.length, i + 4); k++) { const b = lines[k].match(/(\d+\.\d{2})$/); if (b && !/^\d{4}\//.test(lines[k])) { amount = Number(b[1]); tailLine = lines[k]; break; } }
    rest = (rest + " " + tailLine).replace(/\d+\.\d{2}$/, "").replace(/[A-Z0-9_-]{6,}/g, " ");
    const txt = R(rest).replace(/\s+/g, " ").trim();
    const { product, lender } = splitTypeLender(txt);
    inquiries.push({ date: m[1], lender, product, amount });
  }
  const inq6 = inquiries.filter((q) => monthsBetween(q.date, ref) < 6).length;
  const inq12 = inquiries.filter((q) => monthsBetween(q.date, ref) < 12).length;

  // ===== تحقق الاتساق =====
  const activeParsed = facilities.filter((f) => f.status === "current" || f.status === "late").length;
  if (summary.activeCount != null && summary.activeCount !== activeParsed) warnings.push(`الملخص يذكر ${summary.activeCount} منتجات نشطة وقرأنا ${activeParsed} — راجع.`);
  const defParsed = facilities.filter((f) => f.status === "default").length;
  if (!facilities.length) warnings.push("لم نتمكن من قراءة تفاصيل المنتجات — أدخلها يدوياً.");
  const activeExec = judgments.filter((j) => j.active);
  const confidence: ParsedSimah["confidence"] = !facilities.length ? "low" : warnings.length ? "medium" : "high";

  const report: CreditReport = {
    reportMonthsAgo: reportDate ? monthsBetween(reportDate, new Date().toISOString().slice(0, 10).replace(/-/g, "/")) : null,
    reportDate,
    score: null,
    facilities,
    judgments,
    // "عدم تنفيذ" بعد 5 أيام من الإبلاغ يُطبَّق عليه عادة المادة 46 (إيقاف خدمات) — نفترضه حتى يثبت العكس من أبشر/ناجز
    serviceSuspension: activeExec.length > 0,
    suspensionAssumed: activeExec.length > 0,
    inquiries6m: inq6,
    inquiries12m: inq12,
    inquiries,
    summary,
    notes: null,
  };
  if (activeExec.length) warnings.push(`${activeExec.length} قرار تنفيذ بحالة "عدم تنفيذ" — افترضنا وجود إيقاف خدمات (المادة 46). تحقق من أبشر/ناجز.`);
  if (defParsed && summary.defaultedRemaining != null) {
    // ملخص سمة يجمع المتعثرات القائمة + مبالغ قرارات التنفيذ
    const sum = facilities.filter((f) => f.status === "default").reduce((s, f) => s + (f.defaultNow ?? f.balance ?? 0), 0) + activeExec.reduce((s, j) => s + (j.remaining ?? j.amount ?? 0), 0);
    if (Math.abs(sum - summary.defaultedRemaining) > 5) warnings.push(`مجموع المتعثرات المقروء ${Math.round(sum)} يختلف عن ملخص سمة ${Math.round(summary.defaultedRemaining)} — راجع.`);
  }
  return { report, reportDate, summary, inquiries, warnings, confidence };
}
