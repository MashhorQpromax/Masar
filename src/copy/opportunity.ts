/** The words of a deal's opportunities: their classes, how far each can be relied on, and where each figure comes from. */
import type { ApprovalApart, Assumption, ClassReason, Confidence, Footing, OpportunityClass, SettledWait, Settlement } from "@/domain/opportunity";
import { counted, dayOfIso, ltr, money, months, plainMoney } from "./format";
import { PART } from "./knowledge";
import { SOURCE_KIND, TERM_NAME } from "./lenders";
import { NET_PART } from "./net";

export const OPPORTUNITY_CLASS: Record<OpportunityClass, string> = {
  confirmed: "مؤكدة من الجهة",
  ready: "قابلة للتنفيذ مبدئياً",
  theoretical: "نظرية",
  not_viable: "غير قابلة للتنفيذ",
};

/** What each class means, said once where the classes are read. */
export const CLASS_SAY: Record<OpportunityClass, string> = {
  confirmed: "وافقت الجهة كتابةً، والرد مرفق في الملف.",
  ready: "كل شرط ينطبق مستوفى على شروط لها مصدر وتاريخ، ولم ترد الجهة بعد.",
  theoretical: "الحساب يقول ممكنة، وفيها شرط بلا مصدر أو معلومة ناقصة.",
  not_viable: "يمنعها شرط مؤكد أو رفض الجهة أو عجز، فلا تُعرض على العميل.",
};

export const CONFIDENCE: Record<Confidence, string> = {
  high: "ثقة عالية",
  medium: "ثقة متوسطة",
  low: "ثقة منخفضة",
};

/** How firm one thing an opportunity rests on is. */
export const FOOTING: Record<Footing, string> = {
  written: "مكتوب",
  verbal: "شفهي",
  estimate: "تقديري",
  none: "بلا مصدر",
};

const FACTS = { one: "معلومة واحدة", two: "معلومتان", few: "معلومات", many: "معلومة" };

/** Why an opportunity has its class, in one sentence. */
export function reasonText(reason: ClassReason): string {
  switch (reason.code) {
    case "DEFICIT":
      return `يبقى على العميل عجز ${ltr(plainMoney(reason.amount))} ريال.`;
    case "BLOCKED":
      return reason.count === 1 ? "شرط مؤكد من الجهة يمنع العميل." : "شروط مؤكدة من الجهات تمنع العميل.";
    case "REFUSED":
      return `رفضت ${reason.lender} ${PART[reason.part]} في ${dayOfIso(reason.on)}.`;
    case "REPLIED":
      return "وافقت الجهة كتابةً، والرد مرفق في الملف.";
    case "MET":
      return "كل شرط ينطبق مستوفى على شروط موثقة، ولم ترد الجهة بعد.";
    case "ACTIONS":
      return reason.count === 1 ? "مستوفاة على شروط موثقة، وعلى العميل خطوة قبل التقديم." : `مستوفاة على شروط موثقة، وعلى العميل ${counted(reason.count, { one: "خطوة", two: "خطوتان", few: "خطوات", many: "خطوة" })} قبل التقديم.`;
    case "DOUBTS":
      return `${counted(reason.count, { one: "أمر واحد", two: "أمران", few: "أمور", many: "أمراً" })} بلا جواب موثق بعد، فلا تتجاوز «نظرية».`;
    case "INCOMPLETE":
      return "الصفقة ينقصها ما تُحسب به.";
    case "REFUSED_BEFORE":
      return `رفضت ${reason.lender} ${PART[reason.part]} في ${dayOfIso(reason.on)}، ومضى على الرفض ما يستدعي سؤالها من جديد.`;
  }
}

/** What an assumption is about, as its line is labelled. */
export function assumptionLabel(a: Pick<Assumption, "key" | "lender" | "part">): string {
  switch (a.key) {
    case "conditions":
      return `شروط ${a.lender}`;
    case "amount":
      return `مبلغ ${NET_PART[a.part ?? "mortgage"]} من ${a.lender}`;
    case "facts":
      return "بيانات الملف";
    case "obligations":
      return "الالتزامات";
    case "costs":
      return "الرسوم والتكاليف";
  }
}

/** Where an assumption comes from, with its date and how long it holds where it has one. */
export function assumptionSource(a: Pick<Assumption, "key" | "source">): string {
  const s = a.source;
  switch (s.kind) {
    case "reply":
      return s.written
        ? `${a.key === "amount" ? "المبلغ الموافق عليه في" : ""} رد الجهة المكتوب بتاريخ ${dayOfIso(s.on)}، يُعتد به حتى ${dayOfIso(s.until)}`.trim()
        : `سجّله الموظف من الجهة بلا رد مكتوب، بتاريخ ${dayOfIso(s.on)}`;
    case "offer":
      return "عرض الجهة المسجل على الصفقة";
    case "term":
      return `${SOURCE_KIND[s.source.kind]}: ${ltr(s.source.reference)}، بتاريخ ${dayOfIso(s.source.confirmedOn)}، صالح حتى ${dayOfIso(s.until)}`;
    case "computed": {
      const from = s.valuation ? "محسوب من شروط الجهة والتقييم المتوقع" : "محسوب من شروط الجهة";
      return s.open.length > 0 ? `${from}، وبلا مصدر: ${s.open.map((term) => TERM_NAME[term]).join("، ")}` : from;
    }
    case "open": {
      const parts = [s.terms.length > 0 ? `بلا مصدر: ${s.terms.map((term) => TERM_NAME[term]).join("، ")}` : "", s.facts > 0 ? `${counted(s.facts, FACTS)} ناقصة في الملف` : ""].filter(Boolean);
      return parts.join("، و");
    }
    case "conflict":
      return `${counted(s.count, FACTS)} يختلف فيها الملف عن مستند مدقق`;
    case "letters":
      return s.confirmed === s.all ? "كلها بخطابات من الدائنين" : s.confirmed === 0 ? "بلا خطابات من الدائنين" : `${ltr(s.confirmed)} من ${ltr(s.all)} بخطاب من الدائن`;
    case "general":
      return a.key === "costs" ? "محسوبة من التقييم المتوقع والشروط العامة" : "من بيانات الملف والأنظمة العامة";
  }
}

/** Said on every opportunity whose deal pays a default. */
export const SETTLE_WARNING = "سداد التعثر لا يضمن التمويل: يبقى في السجل مسدَّداً لا ممحواً، ولكل جهة مدة انتظار بعده.";

/** Said where a lender looks at a default paid before, when the deal itself pays none. */
export const SETTLED_BEFORE = "في السجل تعثر سُدّد من قبل، ولكل جهة مدة انتظار بعد السداد.";

/** One lender's wait after a default is paid. */
export function waitText(w: SettledWait): string {
  if (w.months == null) return `${w.lender}: مدة الانتظار بعد السداد غير مؤكدة، تُسأل الجهة`;
  const sure = w.confirmed ? "" : " (غير مؤكد)";
  if (w.months === 0) return `${w.lender}: تقبل بعد السداد مباشرة بخطاب المخالصة${sure}`;
  return w.left > 0 ? `${w.lender}: تنتظر ${months(w.months)} بعد السداد، يبقى منها ${months(w.left)}${sure}` : `${w.lender}: تنتظر ${months(w.months)} بعد السداد، وقد مضت${sure}`;
}

/** The waits of one settlement, each lender once. */
export function waitLines(s: Settlement): string[] {
  return [...new Set(s.waits.map(waitText))];
}

/** The difference an opportunity makes to the financing, beside the deal as it stands. */
export function financingDiffText(diff: number): string {
  if (diff === 0) return "مثل الصفقة الآن";
  return diff > 0 ? `${ltr(`+${plainMoney(diff)}`)} عن الصفقة الآن` : `${ltr(plainMoney(diff))} عن الصفقة الآن`;
}

/** Who funds an opportunity, in a few words. */
export function cardLenders(card: { lenders: { mortgage: string | null; personal: string | null }; oneLender: boolean }): { main: string; also: string | null } {
  const { mortgage, personal } = card.lenders;
  if (mortgage && personal && !card.oneLender) return { main: mortgage, also: `والشخصي من ${personal}` };
  return { main: mortgage ?? personal ?? "", also: null };
}

/** The five steps every card is read in. */
export const ROAD = { eligibility: "الأهلية", cost: "التكلفة", fee: "أتعابنا", net: "صافي العميل", verdict: "الحكم" } as const;

/** Under the cost: what it is. */
export const COST_SAY = "ما يُدفع من التمويل قبل العميل: السداد والرسوم.";

/** What a report is, said where it is made and on the report itself. */
export const REPORT_SAY = "نسخة من الدراسة كما هي اليوم، تُحفظ في ملف العميل بتاريخها ولا تتغير.";
export const REPORT_INTERNAL = "للاستخدام الداخلي. فيه أتعاب المكتب، فلا يُرسل إلى العميل كما هو.";

const REPORT_REFUSAL: Record<string, string> = {
  NO_CONSENT: "لا يُنشأ التقرير قبل تسجيل موافقة العميل على حفظ بياناته وقراءتها.",
  NO_OPPORTUNITIES: "لا فرص في الدراسة بعد. أضف الجهات وشروطها أولاً.",
};

/** What to tell a person when a report could not be made. */
export function reportError(code: string, params: Record<string, string> = {}): string {
  if (code === "REPORT_REFUSED" && params.reason && params.reason in REPORT_REFUSAL) return REPORT_REFUSAL[params.reason]!;
  if (code === "FORBIDDEN") return "لا تملك صلاحية هذا.";
  if (code === "NOT_FOUND") return "هذه الصفقة لم تعد موجودة.";
  return "تعذر حفظ التقرير. حاول مرة أخرى.";
}

/** The deal's fee plan, as the card of the plan the deal holds says it. */
export const PLAN_STATE: Record<"stands" | "fell" | "none", string> = {
  stands: "الأتعاب معتمدة",
  fell: "سقط اعتماد الأتعاب",
  none: "الأتعاب غير معتمدة",
};

/**
 * A lender's written approval the deal is not counted on, as a note on the deal and beside the client's
 * offer. It says the two amounts and what to do, and stops nothing.
 */
export function approvalApartText(apart: Pick<ApprovalApart, "part" | "approved" | "counted"> & { lender: string }): string {
  return `موافقة ${apart.lender} المكتوبة على التمويل ${PART[apart.part]} ${money(apart.approved)}، والصفقة محسوبة على ${money(apart.counted)}. احسب الصفقة على مبلغ الموافقة قبل أي عرض للعميل.`;
}
