/** The words of a deal's requests to lenders: the message a lender reads, the road a request travels, and why a step is refused. */
import type { ApproveRefusal, ConsentWay, ContactKind, ContactProblem, PrepareRefusal, RequestStatus, SendRefusal, SharedFacts } from "@/domain/request";
import { NATIONALITY } from "./clients";
import { SECTOR } from "./editor";
import { CONTRACT_TYPE } from "./eligibility";
import { counted, dayOfIso, plainMoney } from "./format";
import { PART } from "./knowledge";
import { OFFICE_NAME } from "./messages";

const YEARS = { one: "سنة", two: "سنتان", few: "سنوات", many: "سنة" };
const MONTHS = { one: "شهر", two: "شهران", few: "أشهر", many: "شهراً" };

/** A length of service the way it is said: "10 سنوات"، "سنتان و6 أشهر"، "8 أشهر". */
export function serviceSaid(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return counted(rest, MONTHS);
  return rest === 0 ? counted(years, YEARS) : `${counted(years, YEARS)} و${counted(rest, MONTHS)}`;
}

/** The credit record as the lender will read it once the deal has settled what it settles. */
export function recordSaid(record: SharedFacts["record"]): string {
  if (!record.known) return "لم يُقرأ تقرير سمة بعد.";
  const delays = record.delays ? "، وفيه تأخر في السداد مؤخراً" : "";
  if (record.open) return `فيه تعثر قائم لم يُسدَّد${delays}.`;
  if (record.settledMonthsAgo === 0) return `فيه تعثر يُسدَّد قبل التقديم وتُرفق مخالصته${delays}.`;
  if (record.settledMonthsAgo != null) return `فيه تعثر سُدِّد قبل ${counted(record.settledMonthsAgo, MONTHS)}${delays}.`;
  return record.delays ? "لا تعثر فيه، وفيه تأخر في السداد مؤخراً." : "لا تعثر فيه ولا تأخر.";
}

/**
 * The message a lender reads. It is plain text a person copies into the lender's email or chat, so
 * it carries no direction marks. It names no client: the reference ties the answer to the file.
 */
export function lenderMessage(facts: SharedFacts): string {
  const asked = facts.legs.map((leg) => `- التمويل ${PART[leg.part]} من منتج «${leg.product}»: نحو ${plainMoney(leg.amount)} ريال على ${counted(leg.months, MONTHS)}.`);
  const line = (label: string, value: string | false | null) => (value ? [`- ${label}: ${value}`] : []);
  const riyals = (amount: number | null) => amount != null && `${plainMoney(amount)} ريال`;
  const who = [
    ...line("الجنسية", NATIONALITY[facts.nationality]),
    ...line("العمر", facts.age != null && counted(facts.age, YEARS)),
    ...line("القطاع", SECTOR[facts.sector]),
    ...line("العقد", facts.contractType && CONTRACT_TYPE[facts.contractType]),
    ...line("مدة الخدمة", facts.serviceMonths != null && serviceSaid(facts.serviceMonths)),
    ...line("الراتب الأساسي", riyals(facts.basicSalary)),
    ...line("الراتب الإجمالي", riyals(facts.totalSalary)),
    ...line("بنك الراتب", facts.salaryBank),
    ...line("توثيق الراتب", facts.incomeVerified ? "موثق بمستند" : "لم يُوثَّق بمستند بعد"),
    ...line("الالتزامات الشهرية بعد التسوية", facts.keptMonthly > 0 ? `${plainMoney(facts.keptMonthly)} ريال` : "لا شيء"),
    ...line("السجل الائتماني", recordSaid(facts.record)),
  ];
  return [
    "السلام عليكم ورحمة الله وبركاته،",
    "",
    `نرجو دراستكم المبدئية لطلب تمويل لعميل لدينا، مرجعه عندنا ${facts.ref}.`,
    "",
    "المطلوب:",
    ...asked,
    "",
    "عن العميل:",
    ...who,
    "",
    "نرجو ردكم كتابةً بالقبول أو الرفض، وبالمبلغ والشروط إن وُجدت.",
    "",
    OFFICE_NAME,
  ].join("\n");
}

export const REQUEST_STATUS: Record<RequestStatus, string> = {
  draft: "بانتظار الاعتماد",
  approved: "معتمد، لم يُرسل",
  sent: "أُرسل، بانتظار الرد",
  answered: "ردّت الجهة",
  closed: "أُغلق",
};

export const CONTACT_KIND: Record<ContactKind, string> = {
  email: "بريد إلكتروني",
  whatsapp: "واتساب",
  phone: "هاتف",
  portal: "بوابة الجهة",
  visit: "زيارة فرع",
};

export const CONTACT_PROBLEM: Record<ContactProblem, string> = {
  STOPPED: "متوقفة",
  NO_SOURCE: "بلا مصدر، لا يُرسل إليها",
  UNCHECKED: "لم يُتحقق منها، لا يُرسل إليها",
  EXPIRED: "انتهى التحقق منها، لا يُرسل إليها حتى يُتحقق من جديد",
};

/** How long a check of a way of reaching a lender holds. */
export function contactUntil(until: string): string {
  return `تحقق صالح حتى ${dayOfIso(until)}`;
}

export const CONSENT_WAY: Record<ConsentWay, string> = {
  written: "كتابةً",
  verbal: "شفهياً",
};

export const PREPARE_REFUSAL: Record<PrepareRefusal, string> = {
  DEAL_ENDED: "الصفقة انتهت، فلا يُجهَّز لها طلب.",
  NO_CONSENT: "لم تُسجَّل موافقة العميل على معالجة بياناته.",
  NO_SHARING: "لم يوافق العميل على مشاركة بياناته مع هذه الجهة. سجّل موافقته أولاً.",
  NOT_APPROVED: "تحليل العميل غير معتمد كما هو الآن، والرسالة لا تُبنى إلا من ملف معتمد.",
  NOT_VIABLE: "الفرصة مع هذه الجهة غير قابلة للتنفيذ.",
  OPEN_REQUEST: "لهذا العميل طلب مفتوح لدى هذه الجهة.",
};

export const APPROVE_REFUSAL: Record<ApproveRefusal, string> = {
  STATUS: "الطلب ليس بانتظار الاعتماد.",
  NO_SHARING: "سُحبت موافقة العميل على المشاركة مع هذه الجهة.",
  NOT_APPROVED: "سقط اعتماد تحليل العميل بعد تجهيز الطلب.",
  NOT_VIABLE: "صارت الفرصة مع هذه الجهة غير قابلة للتنفيذ.",
  STALE: "تغيّر ملف العميل بعد تجهيز الرسالة. أغلق هذا الطلب وجهّز غيره.",
};

export const SEND_REFUSAL: Record<SendRefusal, string> = {
  STATUS: "لا يُسجَّل الإرسال إلا لطلب معتمد.",
  NO_SHARING: "سُحبت موافقة العميل على المشاركة مع هذه الجهة.",
  CONTACT: "اختر وسيلة تواصل للجهة نفسها لها مصدر وتحقق ساري.",
  DAY: "يوم الإرسال لا يسبق الاعتماد ولا يتجاوز اليوم.",
};

/** What to tell a person when a step of a request was refused. */
export function requestError(code: string, params: Record<string, string> = {}): string {
  const reason = params.reason ?? "";
  if (code === "REQUEST_REFUSED" && reason in PREPARE_REFUSAL) return PREPARE_REFUSAL[reason as PrepareRefusal];
  if (code === "APPROVAL_REFUSED" && reason in APPROVE_REFUSAL) return APPROVE_REFUSAL[reason as ApproveRefusal];
  if (code === "SEND_REFUSED" && reason in SEND_REFUSAL) return SEND_REFUSAL[reason as SendRefusal];
  if (code === "BAD_EMAIL") return "البريد الإلكتروني غير صحيح.";
  if (code === "BAD_PHONE") return "الرقم غير صحيح.";
  if (code === "BAD_LINK") return "رابط البوابة غير صحيح. انسخه كما هو من موقع الجهة.";
  if (code === "CONSENT_NEEDED") return "سجّل أولاً موافقة العميل على معالجة بياناته، من ملفه.";
  if (code === "INVALID_STAGE") return "تغيّر حال الطلب. حدّث الصفحة.";
  if (code === "ROUTE_GONE") return "لم تعد هذه الفرصة في الدراسة. حدّث الصفحة.";
  if (code === "FORBIDDEN") return "لا تملك صلاحية هذا.";
  if (code === "NOT_FOUND") return "لم يعد هذا موجوداً.";
  if (code === "INVALID_INPUT") return "راجع ما كتبت.";
  return "تعذر الحفظ. حاول مرة أخرى.";
}

/** How long a sent request has waited. */
export function waitedSaid(days: number): string {
  if (days <= 0) return "أُرسل اليوم";
  return `أُرسل قبل ${counted(days, { one: "يوم", two: "يومين", few: "أيام", many: "يوماً" })}`;
}

/** Under the requests: what the system does and does not do. */
export const SENDS_NOTHING = "النظام لا يرسل شيئاً بنفسه. انسخ الرسالة وأرسلها من وسيلة الجهة، ثم سجّل الإرسال.";
export const NAMES_NOBODY = "الرسالة لا تحمل اسم العميل ولا هويته ولا رقمه. المرجع يربط رد الجهة بالملف.";
/** Kept in step with CONTACT_VALIDITY_MONTHS (six). */
export const CONTACTS_SAY = "لا يُرسل طلب إلا عبر وسيلة لها مصدر، وتحقق منها أحد خلال آخر ستة أشهر. ما عداها محفوظ ولا يُرسل إليه.";
export const FOLLOW_UP_SAY = "طلب أُرسل ولم ترد الجهة بعد المدة المحددة يظهر هنا للمتابعة.";
