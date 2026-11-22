// رسائل واتساب جاهزة: نص عادي بتنسيق واتساب (*عريض* _مائل_) بلا رموز تعبيرية.
// قاعدة صارمة: رسائل العميل لا تحتوي أتعاب الشركة ولا رأس مالها ولا تحليلها الداخلي.

import type { Stage } from "./deal";

export type WaTemplate = "study" | "docs" | "stage" | "internal";
export const WA_TEMPLATES: Record<WaTemplate, { label: string; hint: string; client: boolean }> = {
  study: { label: "ملخص الدراسة", hint: "للعميل: وضعه، الحل، المتوقع، والمطلوب منه", client: true },
  docs: { label: "طلب النواقص", hint: "للعميل: قائمة المستندات الناقصة مع رابط الرفع", client: true },
  stage: { label: "تحديث المرحلة", hint: "للعميل: أين وصل ملفه والخطوة التالية", client: true },
  internal: { label: "ملخص الصفقة", hint: "لشريك أو ممول، وفيه الأرقام الداخلية", client: false },
};

export interface WaContext {
  firstName: string;
  fullName: string;
  fileNo: string;
  staffName: string;
  financeLabel: string;
  isProject: boolean;
  projectHeadline?: string | null;
  salary?: number | null;
  currentDbr?: number | null;
  credit?: {
    executions: number;
    executionsAmount: number;
    defaults: number;
    defaultsAmount: number;
    suspension: boolean;
  } | null;
  deal?: {
    stage: Stage;
    verdict: "go" | "tight" | "short" | "needs_info";
    settleTotal: number; // تنفيذ + تعثرات سنسددها
    payoffTotal: number; // مخالصات تمويل
    payoffLenders: string[];
    mortgage: number;
    personal: number;
    clientNet: number;
    bankName?: string | null;
    // داخلي فقط
    capital: number;
    fee: number;
    feeSettle: number;
    feeFinance: number;
    roi: number | null;
    cover: number | null;
    days: number;
    risks: string[];
    breakEvenDiscount: number | null;
    structureLabel?: string;
    feePct?: { settle: number; finance: number };
    summary?: import("./deal").DealStudy["summary"];
    bestAlt?: string | null;
  } | null;
  missingDocs: { label: string; why?: string }[];
  /** الملف مرفوض (حالة العميل) أو الصفقة خاسرة */
  rejected?: boolean;
  /** أفضل عرض من جهة تمويلية (من «الطلبات لدى الجهات») */
  offer?: { lender: string; lenderType: string; product: string | null; amount: number; tenor: number | null; status: string } | null;
  /** إظهار اسم الجهة للعميل (افتراضياً مخفي حتى لا يتجاوزنا العميل) */
  showLender?: boolean;
  link?: string | null;
  linkDays?: number;
}

/** متى يجوز مراسلة العميل؟ نفكر مثل الوسيط: لا رسالة للعميل إلا لملف قابل للإغلاق */
export function clientGate(c: WaContext): { allowed: WaTemplate[]; reason: string | null; tone: "red" | "amber" | null } {
  if (c.rejected) return { allowed: ["internal"], reason: "الملف مرفوض أو متوقف، فلا تُرسل للعميل أي رسالة. لو تغير الوضع أعد فتح الملف من تبويب «الصفقة».", tone: "red" };
  if (!c.isProject) {
    const v = c.deal?.verdict;
    if (v === "short") return { allowed: ["internal"], reason: `الصفقة لا تقفل بالأرقام الحالية (عجز ${n(Math.max(0, -(c.deal?.clientNet ?? 0)))} ريال)، فالملف بحكم المرفوض ولا نرسل للعميل شيئاً. حسّن الأرقام أو اعتمد الرفض من تبويب «الصفقة».`, tone: "red" };
    if (!c.deal || v === "needs_info") return { allowed: ["docs", "internal"], reason: "دراسة الصفقة لم تكتمل بعد، فالمتاح للعميل طلب النواقص فقط. ملخص الدراسة يُفتح بعد ما تقفل الصفقة بالأرقام.", tone: "amber" };
  } else if (!c.offer) {
    return { allowed: ["study", "docs", "stage", "internal"], reason: "لا يوجد عرض من جهة تمويلية بعد. أضف الجهة والمبلغ في تبويب «الطلبات لدى الجهات» لتبدأ رسالة الدراسة بـ«وفرنا لك جهة تمويلية».", tone: "amber" };
  }
  return { allowed: ["study", "docs", "stage", "internal"], reason: null, tone: null };
}

function tenorAr(m: number) {
  const [k, one, two, few, many] = m >= 24 && m % 12 === 0 ? [m / 12, "سنة", "سنتين", "سنوات", "سنة"] : [m, "شهر", "شهرين", "أشهر", "شهراً"];
  return k === 1 ? one : k === 2 ? two : k <= 10 ? `${k} ${few}` : `${k} ${many}`;
}
const LENDER_KIND: Record<string, string> = { bank: "بنك محلي", finance_company: "شركة تمويل مرخصة من البنك المركزي", fund: "صندوق تمويل" };
function offerBlock(c: WaContext) {
  const o = c.offer;
  if (!o) return null;
  const who = c.showLender ? `*${o.lender}*` : `${LENDER_KIND[o.lenderType] ?? "جهة تمويلية معتمدة"}`;
  const term = o.tenor ? ` على مدة ${tenorAr(o.tenor)}` : "";
  const kind = o.product ? `\n_${o.product}_` : "";
  const amt = `*${approx(o.amount)}* ريال${term}`;
  // الصياغة حسب حالة الطلب فعلاً — لا نوحي بموافقة لم تصدر
  if (o.status === "approved" || o.status === "disbursed")
    return `*بشارة: صدرت الموافقة على تمويلك*\nحصلنا لك على موافقة جهة تمويلية (${who}) بمبلغ ${amt}.${kind}`;
  if (o.status === "draft")
    return `*بشارة: وفرنا لك جهة تمويلية*\nبعد دراسة ملفك حددنا لك جهة تمويلية (${who}) قادرة توصلك إلى تمويل يصل إلى ${amt}.${kind}\nنستكمل معك المتطلبات ونقدّم ملفك حتى نثبت العرض.`;
  return `*بشارة: ملفك الآن لدى جهة تمويلية*\nقدّمنا ملفك لدى جهة تمويلية (${who}) لتمويل يصل إلى ${amt}، والملف قيد الدراسة لديها.${kind}\nنستكمل معك المتطلبات حتى نسرّع الموافقة.`;
}

const n = (v: number) => Math.round(v).toLocaleString("en-US");
const approx = (v: number) => {
  if (v >= 1_000_000) return `${(Math.round(v / 10_000) / 100).toLocaleString("en-US")} مليون`;
  if (v >= 10_000) return `${n(Math.round(v / 1000) * 1000)}`;
  return n(v);
};

/** مراحل مبسطة يفهمها العميل (بدون تفاصيل داخلية) */
export const CLIENT_STEPS: { title: string; stages: Stage[] }[] = [
  { title: "دراسة الملف والاتفاق", stages: ["study", "agreement"] },
  { title: "تسوية الالتزامات والمتعثرات", stages: ["settlement", "clearance"] },
  { title: "تحديث السجل الائتماني (سمة)", stages: ["simah_update"] },
  { title: "مخالصة العقار وتجهيزه", stages: ["payoff", "transfer"] },
  { title: "التقديم للبنك والموافقة", stages: ["bank_submit", "approval"] },
  { title: "صرف التمويل", stages: ["disbursement", "recovered", "closed"] },
];
export function clientStepIndex(stage: Stage) {
  const i = CLIENT_STEPS.findIndex((s) => s.stages.includes(stage));
  return i < 0 ? 0 : i;
}

export const STAGE_NEXT: Partial<Record<Stage, string>> = {
  study: "نراجع ملفك ونجهز لك العرض النهائي.",
  agreement: "بعد التوقيع نبدأ مباشرة بتسوية الالتزامات.",
  settlement: "نسدد القرارات والمتعثرات ونتابع رفع الإيقاف.",
  clearance: "نستلم خطابات المخالصة ونتأكد من رفع الإيقاف.",
  simah_update: "ننتظر تحديث سمة، ويستغرق عادة من أسبوع إلى أسبوعين.",
  payoff: "نُنهي مخالصة التمويل العقاري مع البنك.",
  transfer: "نُنهي إجراءات العقار تمهيداً للتقديم للبنك.",
  bank_submit: "رُفع طلبك للبنك، وسيتواصل معك البنك للتوقيع والتقييم.",
  approval: "البنك يدرس الطلب ويقيّم العقار.",
  disbursement: "صدرت الموافقة، ونُنهي إجراءات الصرف.",
  recovered: "اكتملت العملية بحمد الله.",
  closed: "اكتملت العملية بحمد الله.",
};

function greeting(c: WaContext) {
  return `السلام عليكم ورحمة الله${c.firstName ? ` ${c.firstName}` : ""}\nمعك ${c.staffName} من *مسار للحلول التمويلية*.`;
}
function footer(c: WaContext) {
  const parts: string[] = [];
  if (c.link) parts.push(`*رابط ملفك للمتابعة ورفع المستندات:*\n${c.link}\n_رابط خاص بك، صالح ${c.linkDays ?? 14} يوماً_`);
  parts.push("أي استفسار أنا حاضر هنا.");
  return parts.join("\n\n");
}

export function buildMessage(t: WaTemplate, c: WaContext): string {
  if (t === "internal") return internal(c);
  if (t === "docs") return docs(c);
  if (t === "stage") return stage(c);
  return study(c);
}

function study(c: WaContext) {
  const offer = offerBlock(c);
  const out: string[] = [greeting(c), offer ?? "أنهينا دراسة ملفك، وهذا ملخصها باختصار:"];
  // الوضع الحالي
  const now: string[] = [];
  if (c.credit) {
    if (c.credit.executions) now.push(`- ${c.credit.executions === 1 ? "قرار تنفيذ واحد" : c.credit.executions === 2 ? "قرارا تنفيذ" : `${c.credit.executions} قرارات تنفيذ`} بإجمالي *${n(c.credit.executionsAmount)}* ريال`);
    if (c.credit.defaults) now.push(`- ${c.credit.defaults === 1 ? "تعثر واحد قائم" : `${c.credit.defaults} تعثرات قائمة`} بإجمالي *${n(c.credit.defaultsAmount)}* ريال`);
    if (c.credit.suspension) now.push("- يوجد إيقاف خدمات مرتبط بقرارات التنفيذ");
  }
  if (c.currentDbr != null && c.currentDbr > 0) now.push(`- التزاماتك الشهرية تأخذ *${c.currentDbr}%* من راتبك`);
  if (now.length && !c.isProject) out.push(`*وضعك الحالي*\n${now.join("\n")}`);

  if (c.isProject) {
    if (!offer && c.projectHeadline) out.push(`*نتيجة الدراسة*\n${c.projectHeadline}`);
  } else if (c.deal) {
    const d = c.deal;
    const steps: string[] = [];
    if (d.settleTotal > 0) steps.push(`نسدد عنك قرارات التنفيذ والمتعثرات (نحو ${approx(d.settleTotal)} ريال) ونرفع الإيقاف`);
    if (d.payoffTotal > 0) steps.push(`نُنهي مخالصة تمويلك الحالي${d.payoffLenders.length ? ` لدى ${d.payoffLenders.join(" و")}` : ""}`);
    steps.push("نحدّث سجلك في سمة بعد التسوية");
    const kinds = [d.mortgage > 0 ? "عقاري" : "", d.personal > 0 ? "شخصي" : ""].filter(Boolean).join(" و") || "جديد";
    steps.push(`نتقدم لك${d.bankName ? ` على *${d.bankName}*` : " على البنك المناسب"} بتمويل ${kinds} جديد`);
    out.push(`*الحل المقترح*\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
    if (d.verdict === "go" || d.verdict === "tight") {
      const exp: string[] = [];
      if (d.mortgage > 0) exp.push(`- تمويل عقاري تقريباً *${approx(d.mortgage)}* ريال`);
      if (d.personal > 0) exp.push(`- تمويل شخصي تقريباً *${approx(d.personal)}* ريال`);
      if (d.clientNet > 0) exp.push(`- يبقى لك نقداً بعد إنهاء كل الالتزامات تقريباً *${approx(d.clientNet)}* ريال`);
      exp.push("- التزامات أقل وملف ائتماني نظيف بإذن الله");
      out.push(`*المتوقع لك*\n${exp.join("\n")}`);
    }
    out.push(`*المدة المتوقعة:* من ${Math.max(4, Math.round(d.days / 7) - 2)} إلى ${Math.round(d.days / 7) + 2} أسابيع تقريباً`);
  }
  if (c.missingDocs.length) out.push(`*${offer ? "المطلوب لتثبيت العرض" : "المطلوب منك الآن"}*\n${c.missingDocs.slice(0, 8).map((d, i) => `${i + 1}. ${d.label}`).join("\n")}`);
  out.push("_الأرقام تقديرية وتعتمد على موافقة البنك والتقييم الرسمي._");
  out.push(footer(c));
  return out.join("\n\n");
}

function docs(c: WaContext) {
  const out = [greeting(c)];
  if (!c.missingDocs.length) {
    out.push("وصلتنا كل المستندات المطلوبة، شكراً لتعاونك.\nنكمل الآن على ملفك وأبلغك بأي جديد.");
  } else {
    out.push(`حتى نكمل ملفك بأسرع وقت، نحتاج منك المستندات التالية:\n\n${c.missingDocs.map((d, i) => `${i + 1}. *${d.label}*${d.why ? `\n   _${d.why}_` : ""}`).join("\n")}`);
    out.push(c.link ? "تقدر ترفعها مباشرة من الرابط بالأسفل (صورة واضحة أو PDF)، أو ترسلها هنا." : "أرسلها هنا على الواتساب (صورة واضحة أو PDF).");
  }
  out.push(footer(c));
  return out.join("\n\n");
}

function stage(c: WaContext) {
  const out = [greeting(c)];
  const st = c.deal?.stage ?? "study";
  const idx = clientStepIndex(st);
  out.push(`*تحديث على ملفك*\n\n${CLIENT_STEPS.map((s, i) => `${i + 1}. ${i === idx ? `*${s.title}* (الآن)` : i < idx ? `${s.title} (تم)` : s.title}`).join("\n")}`);
  const next = STAGE_NEXT[st];
  if (next) out.push(`*الخطوة الحالية:* ${next}`);
  if (c.missingDocs.length) out.push(`ما زال ينقصنا: ${c.missingDocs.slice(0, 4).map((d) => d.label).join("، ")}`);
  out.push(footer(c));
  return out.join("\n\n");
}

function internal(c: WaContext) {
  const out = [`*ملخص صفقة، داخلي*\n${c.fullName} · ${c.fileNo}`];
  const d = c.deal;
  if (!d) {
    out.push(c.projectHeadline ?? "لا توجد دراسة صفقة محفوظة.");
    return out.join("\n\n");
  }
  const m = d.summary;
  if (!m) return out.join("\n\n");
  if (d.structureLabel) out[0] += `\nالهيكل: ${d.structureLabel}`;

  // 1) الالتزامات
  const ob = m.obligations.map((o) => `- ${o.label}${o.byBank ? " _(تسدده جهة التمويل الجديدة)_" : ""}: ${n(o.amount)}${!o.byBank && o.original > o.amount + 1 && !/^مخالصة/.test(o.label) ? ` _(بعد خصم من ${n(o.original)})_` : ""}`);
  const kept = m.kept.length ? `\n_يبقى قائماً بدون سداد: ${m.kept.map((k) => `${k.label}${k.monthly ? ` بقسط ${n(k.monthly)} شهرياً` : k.amount ? ` (${n(k.amount)})` : ""}`).join("، ")}_` : "";
  const disc = m.discountTotal ? `\n_وفّرنا بالتفاوض: ${n(m.discountTotal)}_` : "";
  out.push(`*1) الالتزامات اللي تتسدد*\n${ob.join("\n")}\n*الإجمالي: ${n(m.totalObligations)}*${disc}${kept}`);

  // 2) التمويل الجديد
  out.push(`*2) التمويل الجديد*\n${m.financing.map((f) => `- ${f.label}: ${n(f.amount)}`).join("\n")}${m.financing.length > 1 ? `\n*الإجمالي: ${n(m.totalFinancing)}*` : ""}`);

  // 3) بعد السداد
  const after = [`التمويل ${n(m.totalFinancing)}`, `ناقص الالتزامات ${n(m.totalObligations)}`, ...m.costs.map((c) => `ناقص ${c.label} ${n(c.amount)}`)];
  out.push(`*3) بعد سداد كل الالتزامات*\n${after.join("\n")}\n${m.afterSettle >= 0 ? `= يتبقى *${n(m.afterSettle)}*` : `= ينقص *${n(-m.afterSettle)}*، التمويل ما يكفي حتى لسداد الالتزامات`}`);

  // 4) أتعابنا
  const p = d.feePct;
  out.push(`*4) أتعابنا*\n- سداد المتعثرات${p ? ` ${p.settle}%` : ""}: ${n(d.feeSettle)}\n- استخراج التمويل${p ? ` ${p.finance}%` : ""}: ${n(d.feeFinance)}${d.fee !== d.feeSettle + d.feeFinance ? `\n- مقطوع: ${n(d.fee - d.feeSettle - d.feeFinance)}` : ""}\n*الإجمالي: ${n(d.fee)}*`);

  // 5) النتيجة
  const res = m.net >= 0
    ? `*يبقى للعميل ${n(m.net)} ريال* بعد أتعابنا${m.net < 20000 ? " (هامش ضيق)" : ""}`
    : `*عجز ${n(-m.net)} ريال*`;
  out.push(`*5) النتيجة*\n${m.afterSettle >= 0 ? `يتبقى ${n(m.afterSettle)} ناقص أتعابنا ${n(d.fee)}` : `ينقص ${n(-m.afterSettle)} وفوقه أتعابنا ${n(d.fee)}`}\n${res}`);

  const extra = [`رأس المال اللي ندفعه مؤقتاً: ${n(d.capital)} · المدة نحو ${d.days} يوماً${d.cover ? ` · تغطية الضمان ${d.cover}x` : ""}`];
  if (m.keptExecutions) extra.push(`تنبيه: قرارات تنفيذ خارج الحساب بـ ${n(m.keptExecutions)}: الإيقاف ما يرتفع إلا بسدادها كلها، وبدون رفعه ما فيه جهة تصرف`);
  if (m.net < 0 && d.breakEvenDiscount) extra.push(`لسد العجز يلزم خصم نحو ${Math.ceil(d.breakEvenDiscount)}% على التنفيذ والتعثرات`);
  if (d.bestAlt) extra.push(`بديل: ${d.bestAlt}`);
  out.push(extra.join("\n"));
  return out.join("\n\n");
}

/** 05xxxxxxxx / 5xxxxxxxx / +966… / 00966… → 9665xxxxxxxx */
export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  let d = p.replace(/[٠-٩]/g, (x) => String("٠١٢٣٤٥٦٧٨٩".indexOf(x))).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("05") && d.length === 10) d = "966" + d.slice(1);
  else if (d.startsWith("5") && d.length === 9) d = "966" + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

export function waLink(phone: string | null, text: string) {
  return `https://wa.me/${phone ?? ""}?text=${encodeURIComponent(text)}`;
}
