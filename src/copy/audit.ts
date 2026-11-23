/** Wording of the audit log: what each event is called, and the detail worth reading beside it. */
import type { AuditAction, AuditArea, OldAuditAction } from "@/domain/audit";
import { isRole } from "@/domain/auth";
import type { Fee, FeePolicy, FinanceBase } from "@/domain/deal";
import { DECISIONS, RULE_KINDS, type Decision, type RuleKind } from "@/domain/knowledge";
import { ANALYSIS_VERDICT } from "./analysis";
import { openText } from "./approval";
import { ROLE } from "./auth";
import { STAGE } from "./deal";
import { feeText, policyText } from "./fees";
import type { PaperFact } from "@/domain/eligibility";
import { factValue, PAPER_STATUS, paperLabel, sourcePaper, statedLine } from "./documents";
import { counted, dayFull, dayLong, dayOfIso, days, ltr, type CountForms } from "./format";
import { FINANCE_TYPE, PAPER_FACT, SPECIAL_KIND } from "./eligibility";
import { DECISION, PART, RULE_KIND } from "./knowledge";
import { LENDER_TYPE, SOURCE_KIND } from "./lenders";
import { MESSAGE_KIND } from "./messages";

export const AUDIT_AREA: Record<AuditArea, string> = {
  signin: "الدخول",
  users: "الحسابات",
  clients: "العملاء",
  deals: "الصفقات",
  papers: "المستندات",
  messages: "الرسائل",
  lenders: "الجهات",
};

const AUDIT_ACTION: Record<AuditAction, string> = {
  login: "دخول",
  login_failed: "محاولة دخول فاشلة",
  logout: "خروج",
  login_code_sent: "طلب رمز دخول بواتساب",
  "user.create": "حساب جديد",
  "user.update": "تعديل حساب",
  "user.password_reset": "كلمة مرور جديدة من المدير",
  "user.signin_reset": "تصفير طرق الدخول",
  "user.unlock": "فتح قفل حساب",
  "user.confirm": "تأكيد كلمة المرور",
  "user.password": "تغيير كلمة المرور",
  "user.authenticator_on": "ربط تطبيق المصادقة",
  "user.authenticator_off": "إيقاف تطبيق المصادقة",
  "user.passkey_add": "إضافة مفتاح مرور",
  "user.passkey_remove": "حذف مفتاح مرور",
  "user.sessions_end": "إخراج الأجهزة الأخرى",
  "client.create": "فتح ملف عميل",
  "client.update": "تعديل بيانات العميل",
  "client.contact": "تعديل بيانات التواصل",
  "client.note": "ملاحظة على الملف",
  "client.consent": "موافقة العميل على معالجة بياناته",
  "client.condition_answer": "جواب العميل عن شرط جهة",
  "client.fact_rely": "اعتماد ما في مستند على الملف",
  "study.approve": "اعتماد التوصية",
  "client.reject": "رفض الملف",
  "client.reopen": "إعادة الملف إلى الدراسة",
  "credit.report_add": "قراءة تقرير سمة",
  "credit.report_review": "مراجعة تقرير سمة",
  "project.save": "حفظ دراسة مشروع",
  "deal.save": "حفظ أرقام الصفقة",
  "deal.fee": "تعديل أتعاب الصفقة",
  "settings.fees": "تغيير سياسة الأتعاب",
  "deal.stage": "نقل الصفقة",
  "deal.route": "اعتماد جهة التمويل",
  "doc.upload": "رفع ملف",
  "doc.remove": "حذف ملف",
  "doc.move": "وضع ملف تحت مستنده",
  "doc.review": "مراجعة مستند",
  "doc.state": "تسجيل ما في مستند",
  "doc.add": "إضافة مستند مطلوب",
  "doc.drop": "حذف مستند مطلوب",
  "doc.open": "الاطلاع على ملف مرفوع",
  "wa.send": "رسالة إلى العميل",
  "wa.handled": "محادثة لا تحتاج رداً",
  "link.open": "فتح رابط العميل",
  "link.close": "إغلاق رابط العميل",
  "lender.add": "إضافة جهة",
  "lender.product_add": "إضافة منتج",
  "lender.product_update": "تعديل منتج",
  "lender.product_switch": "إيقاف منتج أو إعادته",
  "lender.terms_confirm": "تأكيد شروط منتج",
  "lender.terms_withdraw": "سحب تأكيد شرط",
  "lender.condition_add": "إضافة شرط خاص",
  "lender.condition_remove": "حذف شرط خاص",
  "lender.rule_add": "ملاحظة عن جهة",
  "lender.rule_archive": "حذف ملاحظة عن جهة",
  "lender.decision": "تسجيل قرار جهة",
};

/** What an event is called. An event from a newer build than this wording still gets a name. */
/** What the old system logged and this one has no like of. */
const OLD_ACTION: Record<OldAuditAction, string> = {
  "old.status": "تغيير حالة الملف",
  "old.view": "الاطلاع على بيانات العميل",
  "old.delete": "حذف ملف عميل",
  "old.export": "تصدير ملف العميل",
  "old.study": "حفظ دراسة أهلية",
  "old.obligation_add": "إضافة التزام",
  "old.obligation_remove": "حذف التزام",
  "old.application_add": "طلب تمويل جديد",
  "old.application_update": "تحديث طلب تمويل",
  "old.other": "حدث من النظام السابق",
  "old.moved": "نقل البيانات من النظام السابق",
};

export const auditAction = (action: string): string => AUDIT_ACTION[action as AuditAction] ?? OLD_ACTION[action as OldAuditAction] ?? "حدث آخر";

/** Who did a thing when nobody was signed in: the system itself, a client, or someone at the door. */
export const NOBODY = "بلا حساب";

const METHOD: Record<string, string> = {
  password: "بكلمة المرور",
  "password+totp": "بكلمة المرور ورمز التطبيق",
  passkey: "بالبصمة",
  totp: "برمز التطبيق",
  whatsapp: "برمز واتساب",
  code: "برمز واتساب",
  confirm: "عند تأكيد كلمة المرور",
};

const FIELD: Record<string, string> = {
  phone: "الجوال",
  nationality: "الجنسية",
  nationalId: "رقم الهوية",
  employer: "جهة العمل",
  city: "المدينة",
  email: "البريد",
  fullName: "الاسم",
  birthYear: "سنة الميلاد",
  sector: "القطاع",
  basicSalary: "الراتب الأساسي",
  totalSalary: "الراتب الإجمالي",
  serviceMonths: "مدة الخدمة",
  contractType: "نوع العقد",
  salaryBank: "بنك الراتب",
  role: "الدور",
  active: "حالة الحساب",
};

const TERMS: CountForms = { one: "شرط واحد", two: "شرطان", few: "شروط", many: "شرطاً" };
const MESSAGES: CountForms = { one: "رسالة واحدة", two: "رسالتان", few: "رسائل", many: "رسالة" };
const LINKS: CountForms = { one: "رابط واحد", two: "رابطان", few: "روابط", many: "رابطاً" };
const FACTS: CountForms = { one: "بيان واحد", two: "بيانان", few: "بيانات", many: "بياناً" };
const KEYS: CountForms = { one: "مفتاح مرور واحد", two: "مفتاحا مرور", few: "مفاتيح مرور", many: "مفتاح مرور" };

// What the log keeps beside an event is read as found: it was written by many hands over time, so nothing in it is taken on trust.
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const joined = (parts: (string | null | false | undefined)[]): string => parts.filter(Boolean).join("، ");

const isRuleKind = (value: unknown): value is RuleKind => (RULE_KINDS as readonly unknown[]).includes(value);
const isDecision = (value: unknown): value is Decision => (DECISIONS as readonly unknown[]).includes(value);
const isPart = (value: unknown): value is "mortgage" | "personal" => value === "mortgage" || value === "personal";

/** The figures written down from a paper, as the log kept them. */
function statedFigures(value: unknown): Partial<Record<PaperFact, number>> {
  const kept = record(value);
  return Object.fromEntries((Object.keys(PAPER_FACT) as PaperFact[]).flatMap((fact) => (number(kept[fact]) != null ? [[fact, number(kept[fact])!]] : [])));
}

const isBase = (value: unknown): value is FinanceBase => value === "total" || value === "personal" || value === "mortgage";

/** A fee as the log kept it. Null when it does not read as one. */
function keptFee(value: unknown): Fee | null {
  const kept = record(value);
  const settlePct = number(kept.settlePct);
  const financePct = number(kept.financePct);
  if (settlePct == null || financePct == null || !isBase(kept.financeBase)) return null;
  return { settlePct, financePct, financeBase: kept.financeBase, settleIncludesPayoff: kept.settleIncludesPayoff === true, fixed: number(kept.fixed) ?? 0 };
}

/** A fee policy as the log kept it. Null when it does not read as one. */
function keptPolicy(value: unknown): FeePolicy | null {
  const kept = record(value);
  const fee = keptFee(value);
  const min = number(kept.min);
  const max = number(kept.max);
  return fee && min != null && max != null ? { settlePct: fee.settlePct, financePct: fee.financePct, financeBase: fee.financeBase, min, max } : null;
}

const fields = (value: unknown): string => joined(strings(value).map((name) => FIELD[name]));
const role = (value: unknown): string | null => (isRole(value) ? ROLE[value] : null);

function paper(code: unknown): string | null {
  const known = text(code);
  if (!known) return null;
  if (known.startsWith("custom:")) return "مستند أضفناه";
  const label = paperLabel({ code: known, label: null }, { sector: "gov", nationality: "saudi" });
  // A code with no wording comes back as it went in, and a code is not something to show a person.
  return label === known || /^[a-z0-9_:]+$/.test(label) ? null : label;
}

/**
 * The detail worth reading beside an event: where a deal moved to, which fields changed, why a file
 * was rejected. Empty when the name of the event already says everything. Values the log was told
 * to leave out, a phone or a password, are never here to show.
 */
export function auditDetail(action: string, details: Record<string, unknown> | null | undefined): string {
  const d = details ?? {};
  switch (action) {
    case "login":
      return METHOD[text(d.method) ?? ""] ?? "";
    case "login_failed":
      return joined([METHOD[text(d.method) ?? ""], d.inactive === true && "الحساب موقوف", d.stopped === true && "الرمز موقوف لكثرة الخطأ", text(d.email) && `بريد لا حساب له: ${ltr(text(d.email)!)}`]);
    case "login_code_sent":
      return text(d.failed) ? "لم يُرسل" : "";
    case "user.create":
      return role(d.role) ?? "";
    case "user.update": {
      const change = record(d.role);
      const roles = role(change.from) && role(change.to) ? `من ${role(change.from)} إلى ${role(change.to)}` : null;
      return joined([roles, d.active === false && "أُوقف", d.active === true && "عاد يعمل", strings(d.changed).includes("phone") && "الجوال"]);
    }
    case "user.signin_reset":
      return joined([d.authenticator === true && "تطبيق المصادقة", (number(d.passkeys) ?? 0) > 0 && counted(number(d.passkeys)!, KEYS)]);
    case "client.update":
      return fields(d.changed);
    case "client.contact":
      return joined([fields(d.changed), (number(d.adopted) ?? 0) > 0 && `انضمت ${counted(number(d.adopted)!, MESSAGES)}`, d.via === "inbox" && "من الوارد"]);
    case "client.consent":
      return joined([d.given === false ? "سُحبت" : "سُجلت", d.with === "report" && "مع رفع تقرير سمة"]);
    case "client.condition_answer": {
      const kind = text(d.kind);
      return joined([text(d.lender), kind && kind in SPECIAL_KIND ? SPECIAL_KIND[kind as keyof typeof SPECIAL_KIND] : null, d.answer === "met" ? "مستوفى" : d.answer === "unmet" ? "غير مستوفى" : d.answer === null && "سُحب الجواب"]);
    }
    case "client.fact_rely": {
      // What changed is said with both figures: the log is where a changed salary is traced back to its paper.
      const changes = record(d.changes);
      const said = (Object.keys(PAPER_FACT) as PaperFact[]).flatMap((fact) => {
        const change = record(changes[fact]);
        const to = number(change.to);
        if (to == null) return [];
        const from = number(change.from);
        return [from == null ? `${PAPER_FACT[fact]}: ${factValue(fact, to)}` : `${PAPER_FACT[fact]}: من ${factValue(fact, from)} إلى ${factValue(fact, to)}`];
      });
      const source = text(d.paper);
      return joined([...said, source && `عن ${sourcePaper({ code: source, label: source.startsWith("custom:") ? "مستند أضفناه" : null })}`]);
    }
    case "study.approve": {
      // An incomplete recommendation is approved with what was open in it and the reason, both kept here.
      const verdict = text(d.verdict);
      const open = record(d.open);
      const counts = { verify: open.verify === true, missing: number(open.missing) ?? 0, unconfirmed: number(open.unconfirmed) ?? 0, conflict: number(open.conflict) ?? 0, terms: open.terms === true };
      return joined([
        verdict && verdict in ANALYSIS_VERDICT ? ANALYSIS_VERDICT[verdict as keyof typeof ANALYSIS_VERDICT] : null,
        d.complete === true ? "مكتملة" : d.complete === false && `فيها ${openText({ complete: false, gaps: [], ...counts })}`,
        text(d.reason),
      ]);
    }
    case "client.reject":
      return text(d.reason) ?? "";
    case "credit.report_review":
      return joined([d.suspension === true && "إيقاف خدمات", d.travelBan === true && "منع سفر"]);
    case "project.save":
      return d.created === true ? "مشروع جديد" : strings(d.changed).length > 0 ? `تغيّر ${counted(strings(d.changed).length, FACTS)}` : "";
    case "deal.stage": {
      const to = text(d.to);
      return to && to in STAGE ? `إلى ${STAGE[to as keyof typeof STAGE]}` : "";
    }
    case "deal.route":
      return joined([...new Set([text(record(d.mortgage).lender), text(record(d.personal).lender)])]);
    case "deal.fee": {
      // The fee before and after, and why: the reason is what the log is kept for.
      const before = keptFee(d.before);
      const after = keptFee(d.after);
      return joined([before && after && `من ${feeText(before)} إلى ${feeText(after)}`, text(d.reason)]);
    }
    case "settings.fees": {
      const before = keptPolicy(d.before);
      const after = keptPolicy(d.after);
      return joined([before && `كانت: ${policyText(before)}`, after && `صارت: ${policyText(after)}`]);
    }
    case "doc.upload": {
      // A file that came by WhatsApp and waits to be put under its paper says so in its own name.
      const label = paper(d.paper);
      return joined([label, d.via === "whatsapp" && !label?.includes("واتساب") && "من واتساب", d.via === "portal" && "من صفحة العميل"]);
    }
    case "doc.review": {
      const verdict = text(d.verdict);
      // The figures a person wrote down with the verdict are part of what they said about the paper.
      return joined([paper(d.paper), verdict && verdict in PAPER_STATUS ? PAPER_STATUS[verdict as keyof typeof PAPER_STATUS] : null, verdict === "verified" && statedLine(statedFigures(d.stated))]);
    }
    case "doc.state": {
      const line = statedLine(statedFigures(d.stated));
      return joined([paper(d.paper), line || "سُحب ما كُتب منه"]);
    }
    case "doc.move":
      return paper(d.to) ? `إلى ${paper(d.to)}` : "";
    case "doc.remove":
    case "doc.add":
    case "doc.drop":
    case "doc.open":
      return paper(d.paper) ?? "";
    case "wa.send": {
      const kind = text(d.kind);
      return joined([kind && kind in MESSAGE_KIND ? MESSAGE_KIND[kind as keyof typeof MESSAGE_KIND].label : null, d.via === "manual" && "من الجوال", d.ok === false && "لم تُرسل"]);
    }
    case "wa.handled":
      return (number(d.messages) ?? 0) > 0 ? counted(number(d.messages)!, MESSAGES) : "";
    case "link.open":
      return (number(d.days) ?? 0) > 0 ? `صالح ${days(number(d.days)!)}` : "";
    case "link.close":
      return (number(d.links) ?? 0) > 0 ? counted(number(d.links)!, LINKS) : "";
    case "lender.add":
      return joined([(d.type === "bank" || d.type === "finance_company") && LENDER_TYPE[d.type], text(d.name)]);
    case "lender.product_add":
      return joined([text(d.lender), typeof d.financeType === "string" && d.financeType in FINANCE_TYPE && FINANCE_TYPE[d.financeType as keyof typeof FINANCE_TYPE]]);
    case "lender.product_switch":
      return joined([d.active === false ? "أُوقف" : d.active === true ? "عاد يعمل" : null, text(d.lender)]);
    case "lender.product_update":
      return joined([strings(d.changed).length > 0 && counted(strings(d.changed).length, TERMS), strings(d.unconfirmed).length > 0 && `سقط تأكيد ${counted(strings(d.unconfirmed).length, TERMS)}`]);
    case "lender.terms_confirm": {
      const kind = text(d.kind);
      const until = text(d.validUntil);
      return joined([text(d.lender), text(d.product), strings(d.terms).length > 0 && counted(strings(d.terms).length, TERMS), kind && kind in SOURCE_KIND ? SOURCE_KIND[kind as keyof typeof SOURCE_KIND] : null, until && `حتى ${dayOfIso(until)}`]);
    }
    case "lender.terms_withdraw":
      return joined([text(d.lender), text(d.product), strings(d.terms).length > 0 && counted(strings(d.terms).length, TERMS)]);
    case "lender.condition_add":
    case "lender.condition_remove": {
      const kind = text(record(d.condition).kind);
      return joined([text(d.lender), text(d.product), kind && kind in SPECIAL_KIND ? SPECIAL_KIND[kind as keyof typeof SPECIAL_KIND] : null, d.unconfirmed === true && "سقط تأكيد قائمة الشروط"]);
    }
    case "lender.rule_add":
      return joined([isRuleKind(d.kind) && RULE_KIND[d.kind], text(d.lender) ?? "كل الجهات", text(d.title)]);
    case "lender.rule_archive":
      return text(d.title) ?? "";
    case "lender.decision":
      return joined([isDecision(d.decision) && DECISION[d.decision], text(d.lender), isPart(d.part) && PART[d.part], d.onDeal === true && "حُسبت الصفقة عليه"]);
    default:
      return "";
  }
}

const EVENTS: CountForms = { one: "حدث واحد", two: "حدثان", few: "أحداث", many: "حدثاً" };

/** "60 حدثاً" */
export const eventsCount = (n: number): string => counted(n, EVENTS);


const riyadhDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" });

/** The Riyadh day a moment falls on, as a key to gather the events of one day under. */
export const logDayKey = (at: Date): string => riyadhDate.format(at);

/** The heading of a day in the log: "اليوم", "أمس", "الأحد 22 نوفمبر", and with its year when that is not this year. */
export function logDay(at: Date, now: Date): string {
  const day = logDayKey(at);
  const today = logDayKey(now);
  if (day === today) return "اليوم";
  // Riyadh keeps one clock all year, so yesterday is always a whole day back.
  if (day === logDayKey(new Date(now.getTime() - 24 * 3_600_000))) return "أمس";
  return day.slice(0, 4) === today.slice(0, 4) ? dayLong(at) : dayFull(at);
}

/** Where an event came from, for a way in that failed: an address reads left to right. */
export const fromAddress = (ip: string): string => `من ${ltr(ip)}`;
