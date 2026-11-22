/**
 * The wording of everything the deal engine reports. The engine returns codes and numbers;
 * this file turns them into Arabic. Short sentences, no decoration.
 */
import type {
  Alternative,
  FeeReason,
  FlowPart,
  LedgerLine,
  LedgerSection,
  Risk,
  Stage,
  StationKey,
  Structure,
  Verdict,
} from "@/domain/deal";
import { splitLabel } from "@/domain/deal";
import { counted, dueIn, inDays, ltr, money, months, percent } from "./format";

export const STATION: Record<StationKey, string> = {
  study: "دراسة",
  settle: "تسوية",
  credit: "تحديث سمة",
  property: "مخالصة العقار",
  bank: "البنك",
  payout: "الصرف",
};

export const STAGE: Record<Stage, string> = {
  study: "دراسة الصفقة",
  agreement: "الاتفاق والتوقيع",
  settlement: "سداد التنفيذ والتعثرات",
  clearance: "المخالصات ورفع الإيقاف",
  simah_update: "تحديث سمة",
  payoff: "مخالصة العقار وفك الرهن",
  transfer: "الإفراغ لطرفنا",
  bank_submit: "التقديم للبنك",
  approval: "التقييم والموافقة",
  disbursement: "الصرف والإفراغ للبنك",
  recovered: "استرداد رأس المال والأتعاب",
  closed: "مغلقة",
  lost: "ملغاة",
};

/** What to do while a deal is in a stage, and what to press when it is done. */
export const NEXT_STEP: Record<Stage, { title: string; brief: string; done: string } | null> = {
  study: { title: "اعرض الدراسة على العميل", brief: "عرض الدراسة", done: "وافق العميل" },
  agreement: { title: "وقّع الاتفاقية مع العميل", brief: "توقيع الاتفاقية", done: "تم التوقيع" },
  settlement: { title: "سدّد التنفيذ والتعثرات", brief: "سداد التعثرات", done: "تم السداد" },
  clearance: { title: "المخالصات ورفع الإيقاف", brief: "المخالصات", done: "استلمنا المخالصات" },
  simah_update: { title: "تابع تحديث سمة", brief: "تحديث سمة", done: "تحدّثت سمة" },
  payoff: { title: "خطاب المخالصة وفك الرهن", brief: "خطاب المخالصة", done: "تم فك الرهن" },
  transfer: { title: "أفرغ العقار لطرفنا", brief: "الإفراغ لطرفنا", done: "تم الإفراغ" },
  bank_submit: { title: "قدّم الطلب للبنك", brief: "التقديم للبنك", done: "تم التقديم" },
  approval: { title: "تابع موافقة البنك", brief: "موافقة البنك", done: "وافق البنك" },
  disbursement: { title: "تابع الصرف والإفراغ", brief: "الصرف", done: "تم الصرف" },
  recovered: { title: "استرد رأس المال والأتعاب", brief: "الاسترداد", done: "تم الاسترداد" },
  closed: null,
  lost: null,
};

export const VERDICT: Record<Verdict, string> = {
  go: "الصفقة تُغلق",
  tight: "تُغلق بهامش ضيق",
  short: "لا تُغلق",
  needs_info: "تنقصها قيمة العقار",
};

export const STRUCTURE: Record<Structure, string> = {
  settle_refi_personal: "عقاري وشخصي",
  settle_personal: "شخصي فقط",
  settle_refi: "عقاري فقط",
};

export const FLOW_PART: Record<FlowPart, string> = {
  capital: "استرداد رأس المال",
  buyout: "مخالصة تمويل قائم",
  fee: "أتعابنا",
  costs: "رسوم وتكاليف",
  client: "يبقى للعميل",
};

export const FEE_REASON: Record<FeeReason, string> = {
  SUSPENSION: "إيقاف خدمات",
  FINANCE_CO_DEFAULT: "تعثر شركة تمويل",
  EXECUTIONS: "قرارات تنفيذ",
  NO_COLLATERAL: "بدون ضمان عقاري",
  LOW_COVER: "تغطية ضمان منخفضة",
  NEAR_RETIREMENT: "قرب التقاعد",
  PAID_NEAR_VALUE: "المدفوع يقارب قيمة العقار",
};

const num = (value: unknown): number => (typeof value === "number" ? value : Number(value) || 0);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
const titles = (labels: string[]): string => labels.map((l) => splitLabel(l).title).join("، ");
const cover = (value: unknown): string => ltr(`${num(value)}x`);
const years = (n: number): string => counted(n, { one: "سنة", two: "سنتين", few: "سنوات", many: "سنة" });

/** One risk as a sentence a person can act on. */
export function riskText(risk: Risk): string {
  const p = risk.params;
  switch (risk.code) {
    case "PROPERTY_VALUE_MISSING":
      return "قيمة العقار غير معروفة. اطلب تقييماً معتمداً، فهو سعر البيع للبنك وأساس كل الحساب.";
    case "DEFICIT":
      return p.hasMortgage
        ? `عجز ${money(num(p.deficit))} ريال. التمويل الجديد لا يغطي رأس المال والأتعاب والدفعة الأولى.`
        : `عجز ${money(num(p.deficit))} ريال. صافي الشخصي ${money(num(p.personalCash))} والمطلوب ${money(num(p.required))}.`;
    case "THIN_MARGIN":
      return `يبقى للعميل ${money(num(p.clientNet))} ريال فقط. أي نقص في التقييم أو الموافقة يكسر الصفقة.`;
    case "KEPT_OBLIGATIONS":
      return `التزامات تبقى قائمة (${titles(list(p.labels))}) بقسط ${money(num(p.keptMonthly))} شهرياً، وتُحسب في سقف الاستقطاع.${
        p.missingMonthly ? " أدخل القسط الشهري لكل بند منها ليصح الحساب." : ""
      }`;
    case "EXECUTION_OUTSIDE_DEAL":
      return `${
        num(p.count) === 1 ? "قرار تنفيذ خارج الصفقة" : `${num(p.count)} قرارات تنفيذ خارج الصفقة`
      } بمبلغ ${money(num(p.amount))}. الإيقاف يبقى ما دام أي قرار مفتوحاً، ولا جهة تصرف لعميل عليه إيقاف.`;
    case "DEFAULT_OUTSIDE_DEAL":
      return `تعثر يبقى في سمة بلا سداد (${titles(list(p.labels))}) بمبلغ ${money(num(p.amount))}. أغلب الجهات ترفض مع تعثر قائم مهما صغر.`;
    case "PERSONAL_FROM_FINANCE_CO":
      return `الشخصي من ${str(p.lender) || "شركة تمويل"}، وهامشها أعلى من البنوك${
        p.offerBelowBankEstimate
          ? `: القسط ${money(num(p.personalInstallment))} يعطي ${money(num(p.personal))} بدل ${money(num(p.personalEstimate))} من بنك`
          : ""
      }. وبعض البنوك تتحفظ عليه في أي تمويل لاحق.`;
    case "NO_COLLATERAL":
      return "لا ضمان عقاري في هذا الهيكل، ورأس مالنا مكشوف حتى صرف الشخصي. الضمان سند لأمر عبر نافذ وتعهد بالتحويل فور الصرف، ويُفضّل كفيل غارم.";
    case "COVER_LOW":
      return `تغطية الضمان ${cover(p.cover)}. قيمة العقار لا تغطي رأس مالنا بهامش كافٍ، ولو رفض البنك نبيع بخسارة.`;
    case "COVER_SENSITIVE":
      return `تغطية الضمان ${cover(p.cover)}. مقبولة لكنها حساسة لانخفاض التقييم.`;
    case "FINANCE_CO_DEFAULT_HISTORY":
      return "تعثر شركة التمويل يبقى في سمة بحالة مسدد، وكثير من البنوك تطلب مرور 12 إلى 24 شهراً. قدّم على بنك الراتب أو بنك يقبل التعثر المسدد.";
    case "BANK_WAIT":
      return `حسب تحليل سمة قد تطلب البنوك انتظار ${months(num(p.months))} بعد التسوية، وهذا يطيل مدة رأس المال.`;
    case "SUSPENSION_LIFT":
      return `الإيقاف يُرفع آلياً بعد سداد قرارات التنفيذ في ناجز. تأكد قبل ${p.hasMortgage ? "الإفراغ والتقديم" : "التقديم"} للبنك.`;
    case "NEAR_RETIREMENT":
      return `يتقاعد بعد ${years(num(p.years))}، وقسط العقاري بعد التقاعد مقيّد بالمعاش التقديري ${money(num(p.pension))}. اطلب منتجاً متدرجاً.`;
    case "INCOME_BOUND":
      return `العقاري محكوم بالدخل (${money(num(p.mortgageByIncome))}) لا بقيمة العقار (${money(num(p.mortgageByLtv))}). الدفعة الأولى ${money(num(p.downPayment))} تُدفع من الشخصي.`;
    case "PAYOFF_UNCONFIRMED":
      return "مبلغ مخالصة العقاري تقديري. اطلب خطاب المديونية من البنك قبل الالتزام.";
    case "NEGOTIATE_EXECUTIONS":
      return "فاوض طالبي التنفيذ على خصم قبل السداد. كل ريال خصم يذهب مباشرة لهامش الصفقة.";
    case "TRANSFER_TAX":
      return `ضريبة التصرفات ${money(num(p.transferTax))} عند الإفراغ لطرفنا. تحقق من الإعفاءات قبل الإفراغ.`;
    case "RECOVERY_GUARANTEES":
      return "ضمانات الاسترداد: عقد بيع موثق للعقار، سند لأمر عبر نافذ، وتحويل الدفعة من البنك لطرفنا مباشرة متى أمكن.";
    case "DBR_OVER_CAP":
      return `الاستقطاع بعد التمويل ${percent(num(p.dbrAfter))} يتجاوز سقف ساما ${percent(num(p.cap))}. راجع أرقام البنك.`;
    case "FEE_OVER_MAX":
      return `الأتعاب تتجاوز الحد الأعلى ${percent(num(p.max))}.`;
  }
}

/** A way to close a deal that is short, or why a way does not work. */
export function alternativeText(alt: Alternative): { title: string; detail: string } {
  const p = alt.params;
  switch (alt.code) {
    case "STRUCTURE_CLOSES":
      return {
        title: `هيكل «${STRUCTURE[str(p.structure) as Structure]}» يغلقها`,
        detail: `يبقى للعميل ${money(num(p.clientNet))} ريال وأتعابنا ${money(num(p.fee))}.`,
      };
    case "DISCOUNT_CLOSES": {
      const pct = num(p.pct);
      return {
        title: `خصم ${percent(pct)} من الدائنين يغلقها`,
        detail: `نسدد ${money(num(p.payAfter))} بدل ${money(num(p.payBefore))}. ${
          pct <= 35 ? "خصم واقعي، ابدأ التفاوض." : pct <= 55 ? "خصم كبير، ممكن مع الديون القديمة وشركات التحصيل فقط." : "خصم غير واقعي غالباً."
        }`,
      };
    }
    case "FEE_MIN_CLOSES":
      return {
        title: `تخفيض الأتعاب إلى ${percent(num(p.pct))} يغلقها`,
        detail: `يبقى للعميل ${money(num(p.clientNet))} ريال.`,
      };
    case "FEE_MIN_NOT_ENOUGH":
      return { title: "تخفيض الأتعاب للحد الأدنى لا يكفي", detail: `يبقى عجز ${money(num(p.deficit))} ريال حتى بأقل نسبة.` };
    case "ZERO_FEE_STILL_SHORT":
      return {
        title: "لا تُغلق حتى بلا أتعاب",
        detail: `يبقى عجز ${money(num(p.deficit))} ريال. المشكلة في قدرة التمويل لا في نسبتنا.`,
      };
    case "PERSONAL_COVERS_UNDER_5PCT":
      return {
        title: "الشخصي لا يغطي حتى 5% من المتعثرات",
        detail: `صافي الشخصي ${money(num(p.personalCash))} ريال فقط.`,
      };
    case "PERSONAL_PARTIAL_COVER":
      return {
        title: `الشخصي يغطي سداد ${money(num(p.covers))} فقط`,
        detail: `من أصل ${money(num(p.settleBase))}. السداد الجزئي ممكن، لكن الإيقاف لا يُرفع إلا بسداد كل قرارات التنفيذ.`,
      };
    case "KEEP_PERSONAL_TOP_UP":
      return {
        title: `إبقاء الشخصي القائم مع تمويل إضافي: صافي ${money(num(p.netTopUp))}`,
        detail: `يبقى ${money(num(p.left))} من سقف القسط، مقابل صافي ${money(num(p.personalCash))} لو اشترى البنك الشخصي القائم. ${
          p.better ? "الإبقاء أفضل هنا." : "الشراء أفضل."
        }`,
      };
    case "HIGHER_VALUATION":
      return {
        title: `تقييم ${money(num(p.value))} يغلقها`,
        detail: `أعلى من الحالي بنسبة ${percent(num(p.upliftPct))}. اطلب تقييماً معتمداً ثانياً إن كان السوق يسمح.`,
      };
    case "CO_BORROWER":
      return {
        title: `متضامن براتب ${money(num(p.salary))} يغلقها`,
        detail: "زوج أو قريب يدخل متضامناً في التمويل العقاري، فيرتفع مبلغه ويسد العجز.",
      };
  }
}

export const LEDGER_SECTION: Record<LedgerSection, string> = {
  personal: "التمويل الشخصي الجديد",
  mortgage: "التمويل العقاري الجديد",
  dues: "مستحقاتنا",
  result: "النتيجة",
};

const share = (value: unknown): string => percent(Math.round(num(value) * 10000) / 100);

/** One line of the step by step calculation: what it is, and how it was worked out. */
export function ledgerText(line: LedgerLine): { label: string; how?: string } {
  const p = line.params ?? {};
  const key = `${line.section}.${line.key}`;
  switch (key) {
    case "personal.salary":
      return { label: "الراتب الإجمالي" };
    case "personal.max_installment":
      return p.limitedByTotalCap
        ? {
            label: "أقصى قسط شخصي",
            how: `سقف الاستقطاع الكلي ${share(p.totalCap)} ناقص الأقساط القائمة: ${money(num(p.salary))} × ${share(p.totalCap)} − ${money(num(p.keptMonthly))}`,
          }
        : { label: "أقصى قسط شخصي", how: `ساما: ${share(p.rule)} من الراتب` };
    case "personal.installments_total":
      return { label: "مجموع الأقساط", how: `${money(num(p.installment))} × ${ltr(num(p.months))} شهراً` };
    case "personal.ceiling":
      return { label: `سقف ${str(p.lender) || "الجهة"} للشخصي`, how: `القسط يحتمل ${money(num(p.estimate))}، والجهة لا تتجاوز سقفها` };
    case "personal.principal":
      return p.fromOffer
        ? { label: `أصل التمويل، عرض ${str(p.lender) || "البنك"}`, how: p.lenderKind === "finance_co" ? "شركة تمويل" : undefined }
        : p.held
          ? { label: "أصل التمويل: سقف الجهة" }
          : { label: "أصل التمويل", how: `هامش ثابت ${percent(num(p.flat))} سنوياً لمدة ${years(num(p.years))}` };
    case "personal.buyout": {
      const { title, party } = splitLabel(str(p.label));
      return { label: `شراء ${title}${party ? ` (${party})` : ""}`, how: "يسدده الممول الجديد من نفس التمويل" };
    }
    case "personal.admin_fee":
      return { label: "رسوم إدارية", how: `${percent(1)} بحد أقصى ${money(5000)}` };
    case "personal.net_to_client":
      return { label: "صافي يستلمه العميل" };
    case "mortgage.available_installment":
      return {
        label: "القسط العقاري المتاح",
        how: `سقف الاستقطاع ${share(p.totalCap)} ناقص القسط الشخصي${num(p.keptMonthly) ? " والأقساط القائمة" : ""}`,
      };
    case "mortgage.post_retirement_installment":
      return { label: "القسط بعد التقاعد", how: `ضمن المعاش التقديري ${money(num(p.pension))}` };
    case "mortgage.income_limit":
      return { label: "حد الدخل", how: `${ltr(num(p.months))} شهراً بهامش ${percent(num(p.apr))} متناقص` };
    case "mortgage.value_limit":
      return { label: "حد قيمة العقار", how: `${money(num(p.propertyValue))} × ${percent(num(p.ltvPct))}` };
    case "mortgage.ceiling":
      return { label: `سقف ${str(p.lender) || "الجهة"} للعقاري` };
    case "mortgage.mortgage":
      return { label: p.fromOffer ? "العقاري، عرض البنك" : p.held ? "العقاري: سقف الجهة" : "العقاري: الأقل من الحدّين" };
    case "mortgage.down_payment":
      return { label: "الدفعة الأولى، يدفعها العميل", how: `سعر البيع ${money(num(p.price))} ناقص العقاري ${money(num(p.mortgage))}` };
    case "dues.item":
      return { label: str(p.label) };
    case "dues.transfer_tax":
      return { label: "ضريبة التصرفات عند الإفراغ لطرفنا", how: `${money(num(p.propertyValue))} × ${percent(num(p.pct))}` };
    case "dues.fixed_costs":
      return { label: "تكاليف ثابتة: تقييم وسعي ورسوم" };
    case "dues.capital":
      return { label: "رأس المال الذي ندفعه" };
    case "dues.fee_settle":
      return { label: "أتعاب السداد", how: `${money(num(p.base))} × ${percent(num(p.pct))}` };
    case "dues.fee_finance":
      return { label: "أتعاب استخراج التمويل", how: `${money(num(p.base))} × ${percent(num(p.pct))}` };
    case "dues.fee_fixed":
      return { label: "أتعاب مقطوعة" };
    case "dues.sale_recovery":
      return { label: "نسترده من ثمن بيع العقار للبنك" };
    case "dues.due_from_client":
      return { label: line.value < 0 ? "فائض من ثمن البيع يعود للعميل" : "المطلوب من العميل لنا" };
    case "result.net_financing":
      return { label: "صافي التمويل الشخصي للعميل" };
    case "result.down_payment":
      return { label: "الدفعة الأولى" };
    case "result.dues":
      return { label: line.value > 0 ? "فائض البيع العائد للعميل" : "المطلوب لنا" };
    case "result.client_net":
      return { label: p.deficit ? "عجز" : "يبقى للعميل" };
    default:
      return { label: line.key };
  }
}

/** What the road needs to know about a deal to describe it in one short line. */
export interface DealGlance {
  stage: Stage;
  verdict: Verdict | null;
  clientNet: number | null;
  daysToDisbursement: number | null;
  stageDueInDays: number | null;
}

export type GlanceTone = "hot" | "bad" | "warn" | "plain";

/**
 * One short line about a deal, and how loudly to show it. Problems come first, then the deal closest
 * to disbursement, then the step in hand.
 */
export function glance(deal: DealGlance, nearest: boolean): { tone: GlanceTone; text: string } {
  if (deal.verdict === "short") return { tone: "bad", text: `عجز ${money(Math.max(0, -(deal.clientNet ?? 0)))}` };
  if (deal.verdict === "needs_info") return { tone: "warn", text: "تنقصه قيمة العقار" };
  if (nearest && deal.daysToDisbursement != null) return { tone: "hot", text: `الصرف ${inDays(deal.daysToDisbursement)}` };
  if (deal.verdict === "tight") return { tone: "warn", text: "هامش ضيق" };
  const step = NEXT_STEP[deal.stage];
  if (!step) return { tone: "plain", text: STAGE[deal.stage] };
  return { tone: "plain", text: deal.stageDueInDays == null ? step.brief : `${step.brief}، ${dueIn(deal.stageDueInDays)}` };
}

/** What to do next on a deal, in a few words. A deal that does not close has to be fixed first. */
export function nextAction(deal: Pick<DealGlance, "stage" | "verdict">): string {
  if (deal.verdict === "short") return "عالج العجز قبل أي خطوة";
  if (deal.verdict === "needs_info") return "أدخل قيمة العقار";
  return NEXT_STEP[deal.stage]?.title ?? STAGE[deal.stage];
}

/** Order of attention when several deals share a station. Lower comes first. */
export function attention(tone: GlanceTone): number {
  return { hot: 0, bad: 1, warn: 2, plain: 3 }[tone];
}
