// المستشار: ما لا تقوله المعادلة — الاشتراطات الخفية، الاستثناءات، والمخارج.
// دوال نقية فوق المحرك. القواعد هنا «ممارسة سوق» عامة ويكمّلها الفريق من صفحة خبرة الجهات.
import type { CreditAnalysis } from "./simah.ts";
import { study, fmt, capacity, SAMA, type Profile, type Product, type Study, type Match } from "./engine.ts";

export type AlertLevel = "block" | "warn" | "info";
export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
  detail: string;
  exit?: string; // المخرج المقترح
  source: "ساما" | "ممارسة سوق" | "خبرة الفريق" | "تحليل تقرير سمة";
}

export interface Scenario {
  key: string;
  title: string;
  detail: string;
  amount: number; // أفضل مبلغ بعد تطبيق المخرج
  gain: number; // الزيادة عن الوضع الحالي
  verdictAfter: Study["verdict"];
  effort: "سهل" | "متوسط" | "صعب";
  steps: string[];
}

export interface DeepStudy extends Study {
  alerts: Alert[];
  scenarios: Scenario[];
  baseAmount: number;
  credit?: CreditAnalysis | null;
}

const yrs = (m: number) => Math.round((m / 12) * 10) / 10;

/** الاشتراطات التي قد تطلبها الجهات ولا تظهر في الحسبة */
export function hiddenConditions(p: Profile, s: Study): Alert[] {
  const a: Alert[] = [];
  const best = s.matches.find((m) => m.verdict !== "fail");
  const tenor = best?.tenor ?? p.requestedTenor ?? (p.financeType === "mortgage" ? 300 : 60);
  const ageEnd = p.age != null ? p.age + tenor / 12 : null;
  const amount = best?.offerPrincipal ?? p.requestedAmount ?? 0;
  const salary = p.totalSalary ?? p.basicSalary ?? 0;
  const push = (x: Alert) => a.push(x);

  // ===== العمر والصحة =====
  if (p.financeType === "mortgage" && p.age != null) {
    if (p.age >= 50 || (ageEnd != null && ageEnd > 65) || amount > 2_500_000)
      push({
        id: "medical",
        level: "warn",
        title: "احتمال طلب تقرير/فحص طبي",
        detail: `التأمين التكافلي على الحياة شرط في التمويل العقاري. ${p.age >= 50 ? `العمر ${p.age}` : ""}${ageEnd && ageEnd > 65 ? `${p.age >= 50 ? " و" : ""}نهاية التمويل عند ${Math.round(ageEnd)} سنة` : ""}${amount > 2_500_000 ? " ومبلغ يتجاوز 2.5 مليون" : ""} — كثير من الجهات تطلب إفصاحاً صحياً أو فحصاً طبياً، وقد ترفع قسط التأمين أو تستثني أمراضاً سابقة.`,
        exit: "جهّز تقريراً طبياً حديثاً مسبقاً، أو قصّر المدة لتنتهي قبل 65، أو أضف متضامناً أصغر سناً، أو قسّم المبلغ تحت 2.5 مليون.",
        source: "ممارسة سوق",
      });
    if (p.age < 25)
      push({ id: "young", level: "info", title: "عمر صغير للتمويل العقاري", detail: "بعض الجهات تشترط خدمة 12 شهراً فأكثر أو استقراراً وظيفياً واضحاً، وقد تطلب متضامناً.", exit: "قدّم لجهة الراتب أولاً وأرفق ما يثبت الاستقرار (عقد دائم/تثبيت).", source: "ممارسة سوق" });
  }
  if (p.financeType !== "mortgage" && ageEnd != null && ageEnd > SAMA.retirementAge && !["retired", "self"].includes(p.sector))
    push({ id: "retire_personal", level: "warn", title: "التمويل يتجاوز سن التقاعد", detail: `ينتهي التمويل عند ${Math.round(ageEnd)} سنة. منتجات «قرب التقاعد» تشترط عادة خدمة 20 سنة مدني / 17 عسكري / 25 تأمينات، ويُحسب الاستقطاع على المعاش.`, exit: "قصّر المدة لتنتهي قبل 60، أو اطلب منتج «قرب التقاعد» لدى بنك الراتب.", source: "ممارسة سوق" });

  // ===== التقاعد في العقاري =====
  const ret = s.matches.find((m) => m.retirement && m.retirement.after < m.installment * 0.95)?.retirement;
  if (ret)
    push({ id: "stepdown", level: ret.after < ret.before * 0.5 ? "warn" : "info", title: "قسط متدرج بعد التقاعد", detail: `${ret.note}. الجهات تحسب الأهلية على المعاش لما بعد التقاعد، لذلك المبلغ أقل من حسبة الراتب وحده.`, exit: "أضف دخل متضامن، أو ارفع الدفعة الأولى، أو اختر جهة تسمح بعمر 70–75 عند الانتهاء مع إثبات المعاش.", source: "ممارسة سوق" });

  // ===== الجنسية =====
  if (p.nationality === "non_saudi") {
    push({ id: "iqama", level: "info", title: "اشتراطات المقيم", detail: "تُطلب صلاحية إقامة وعقد عمل يغطيان مدة التمويل أو تعهد من جهة العمل، وقد تطلب الجهة كفيلاً أو تحويل مكافأة نهاية الخدمة، وجهة عمل معتمدة لديها.", exit: "خطاب تعهد من جهة العمل بتحويل الراتب والمستحقات، ومدة لا تتجاوز العقد.", source: "ممارسة سوق" });
    if (p.financeType === "mortgage")
      push({ id: "expat_mortgage", level: "warn", title: "تمويل عقاري لغير سعودي", detail: "عدد قليل من الجهات يقدمه، بنسبة تمويل أقل (غالباً 70% أو أقل) ويفضل الإقامة المميزة، ويحتاج تملك الأجنبي موافقة نظامية.", exit: "دفعة أولى 30%+، والبدء بجهات لديها برنامج للمقيمين أو الإقامة المميزة.", source: "ممارسة سوق" });
  }

  // ===== جهة العمل والدخل =====
  if (p.sector === "private")
    push({ id: "employer_list", level: "warn", title: "جهة عمل غير مصنفة لدى الجهات", detail: "البنوك تعمل بقوائم شركات معتمدة (أ/ب/ج). غير المصنفة تُرفض أو تُعامل بنسبة أعلى ومبلغ أقل، وتُطلب خدمة 12 شهراً واشتراك تأمينات منتظم.", exit: "اطلب من الجهة تصنيف الشركة (خطاب + سجل تجاري + عدد موظفين)، أو ابدأ بشركات التمويل.", source: "ممارسة سوق" });
  if ((p.sector === "private" || p.sector === "private_approved") && p.serviceMonths != null && p.serviceMonths < 12)
    push({ id: "probation", level: p.serviceMonths < 3 ? "warn" : "info", title: "خدمة قصيرة / فترة تجربة", detail: `الخدمة ${p.serviceMonths} شهر. فترة التجربة في نظام العمل قد تصل 180 يوماً، وكثير من الجهات تشترط 3–12 شهراً مع نفس جهة العمل.`, exit: "ارفق ما يثبت الخدمة السابقة المتصلة (برنت تأمينات كامل)؛ بعض الجهات تضمها إن لم يكن هناك انقطاع.", source: "ممارسة سوق" });
  if (p.sector === "private" || p.sector === "private_approved")
    push({ id: "gosi_match", level: "info", title: "مطابقة الراتب مع التأمينات", detail: "تقارن الجهة تعريف الراتب ببرنت التأمينات وكشف الحساب؛ أي فرق يخفض الدخل المعتمد إلى الأقل.", exit: "تأكد قبل التقديم أن الراتب المسجل في التأمينات يطابق التعريف.", source: "ممارسة سوق" });
  if (p.basicSalary && p.totalSalary && p.basicSalary < p.totalSalary * 0.6)
    push({ id: "allowances", level: "info", title: "البدلات نسبة كبيرة من الراتب", detail: `الأساسي ${fmt(p.basicSalary)} من إجمالي ${fmt(p.totalSalary)}. بعض الجهات لا تحتسب بدل السكن السنوي أو البدلات غير الثابتة، فينخفض الدخل المعتمد.`, exit: "تعريف راتب يوضح أن البدلات شهرية ثابتة، والتقديم لجهات تعتمد الإجمالي.", source: "ممارسة سوق" });
  if (p.sector === "self")
    push({ id: "self", level: "warn", title: "صاحب عمل حر", detail: "يُطلب سجل تجاري عمره سنتان فأكثر، قوائم مالية مدققة، شهادة زكاة، وكشف 12 شهراً، والدخل المعتمد صافي الربح لا الإيرادات.", exit: "رتّب القوائم والكشوف مسبقاً، وابدأ بجهات تمويل المنشآت أو شركات التمويل.", source: "ممارسة سوق" });
  if (p.sector === "military")
    push({ id: "military", level: "info", title: "عسكري", detail: "بعض الجهات لها منتجات خاصة لجهات عسكرية بعينها بنسب أفضل، وقد تطلب تعريفاً بالرتبة وموافقة الجهة على الاستقطاع. سن التقاعد قد يكون أبكر حسب الرتبة.", exit: "تأكد من سن التقاعد المتوقع للرتبة وعدّل المدة.", source: "ممارسة سوق" });
  if (p.sector === "retired")
    push({ id: "retired", level: "info", title: "متقاعد", detail: "الاستقطاع 25% من المعاش (ساما)، وأقصى عمر عند الانتهاء غالباً 70–75، ويُطلب تعريف المعاش وكشف حساب.", source: "ساما" });

  // ===== سمة =====
  if (p.simah === "late")
    push({ id: "simah_late", level: "warn", title: "تأخر في سمة", detail: "أغلب البنوك تشترط مرور 6–12 شهراً بانتظام بعد آخر تأخير، وقد تطلب خطاب تفسير.", exit: "سدد المتأخرات الآن، اطلب تحديث سمة، وقدّم لجهات تقبل التأخر البسيط.", source: "ممارسة سوق" });
  if (p.simah === "default")
    push({ id: "simah_default", level: "block", title: "تعثر قائم في سمة", detail: "يمنع القبول لدى أغلب الجهات حتى السداد والمخالصة وتحديث السجل (قد يستغرق التحديث حتى 30 يوماً).", exit: "تسوية المديونية، خطاب مخالصة، ثم إعادة الدراسة بعد ظهور التحديث.", source: "ممارسة سوق" });
  if (p.simah === "unknown")
    push({ id: "simah_unknown", level: "info", title: "سمة لم يُستخرج", detail: "قد يحتوي التقرير على التزامات غير مصرح بها (بطاقات، نقاط بيع، تقسيط اتصالات) تغيّر الحسبة كلياً.", exit: "استخرج تقرير سمة قبل أي وعد للعميل.", source: "ممارسة سوق" });

  // ===== الالتزامات وتحويل الراتب =====
  const lockedAtSalaryBank = p.obligations.some((o) => o.kind !== "mortgage" && p.salaryBank && o.lender && o.lender.includes(bankName(p.salaryBank)));
  if (p.obligations.some((o) => o.kind !== "card" && o.monthly > 0) && p.salaryBank)
    push({ id: "transfer_lock", level: "warn", title: "قرض قائم مرتبط بتحويل الراتب", detail: `نقل الراتب من ${bankName(p.salaryBank)} لجهة أخرى يتطلب غالباً سداد القرض القائم أو «شراء المديونية» من الجهة الجديدة وخطاب إخلاء طرف.${lockedAtSalaryBank ? " (الالتزام مسجل لدى بنك الراتب نفسه)" : ""}`, exit: "اطلب من الجهة الجديدة شراء المديونية ضمن العرض، أو ابدأ بإعادة التمويل لدى بنك الراتب.", source: "ممارسة سوق" });
  if (p.obligations.some((o) => o.kind === "card"))
    push({ id: "cards", level: "info", title: "البطاقات الائتمانية", detail: "تُحتسب البطاقة في الاستقطاع حتى لو كان رصيدها صفراً (نسبة من الحد) لدى بعض الجهات.", exit: "إلغاء البطاقات غير المستخدمة أو تخفيض حدها قبل التقديم يرفع القسط المتاح.", source: "ممارسة سوق" });
  if (p.financeType === "personal" && p.obligations.some((o) => o.kind === "personal"))
    push({ id: "topup", level: "info", title: "تمويل إضافي بدل قرض جديد", detail: "بنك الراتب يقدم غالباً «تمويلاً إضافياً» يدمج القرض القائم ويعطي صافي نقد، دون نقل الراتب.", source: "ممارسة سوق" });

  // ===== العقاري =====
  if (p.financeType === "mortgage") {
    if (p.firstHome === false)
      push({ id: "second_home", level: "warn", title: "ليس المسكن الأول", detail: "الحد النظامي لتمويل المسكن الثاني 70% من القيمة؛ أي دفعة أولى 30%.", exit: "جهّز الدفعة أو اختر عقاراً أقل قيمة.", source: "ساما" });
    if (p.nationality === "saudi" && !p.housingSupport && p.firstHome !== false && (incomeTotal(p) <= SAMA.lowBracket))
      push({ id: "sakani", level: "info", title: "تحقق من استحقاق سكني", detail: "المستفيد من الدعم السكني يرتفع سقف استقطاعه إلى 65% (دخل ≤ 15 ألف)، ويتحمل الصندوق جزءاً من الأرباح.", exit: "التحقق من الاستحقاق في منصة سكني قبل التقديم قد يرفع المبلغ كثيراً.", source: "ساما" });
    push({ id: "valuation", level: "info", title: "التقييم وحالة العقار", detail: "يُموَّل على الأقل من السعر والتقييم المعتمد. تُطلب صكوك إلكترونية، وقد ترفض الجهات المباني القديمة جداً أو غير المكتملة، والبيع على الخارطة يحتاج ترخيص «وافي».", exit: "اطلب تقييماً مبدئياً قبل دفع العربون.", source: "ممارسة سوق" });
  }
  if (p.financeType === "auto")
    push({ id: "auto_ins", level: "info", title: "تكاليف السيارة الخفية", detail: "التأمين الشامل إلزامي كل سنة (يُضاف للقسط أو يُدفع سنوياً)، وقد توجد دفعة أخيرة (بالون) ودفعة أولى.", exit: "قارن التكلفة الشاملة لا القسط فقط.", source: "ممارسة سوق" });
  if (p.financeType === "card")
    push({ id: "card_limit", level: "info", title: "حد البطاقة", detail: "الحد عادة 2–3 أضعاف الراتب ويدخل في نسبة الاستقطاع.", source: "ممارسة سوق" });

  // ===== تكاليف المعيشة =====
  if (salary > 0 && salary < 8000 && (p.obligations.length > 0))
    push({ id: "living", level: "info", title: "اختبار تكاليف المعيشة", detail: "تلزم ساما الجهات بمراعاة المصاريف الأساسية؛ مع دخل منخفض وعدد معالين كبير قد تخفض الجهة المبلغ عن الحد النظامي.", source: "ساما" });

  push({ id: "inquiries", level: "info", title: "لا تقدّم لعدة جهات معاً", detail: "كل طلب يسجل استعلاماً في سمة؛ الاستعلامات الكثيرة في فترة قصيرة تُقرأ كمؤشر خطر وقد ترفض جهات لاحقة.", exit: "قدّم بالتتابع حسب ترتيب المطابقة.", source: "ممارسة سوق" });

  const order: Record<AlertLevel, number> = { block: 0, warn: 1, info: 2 };
  return a.sort((x, y) => order[x.level] - order[y.level]);
}

function incomeTotal(p: Profile) {
  return capacity(p).income;
}

const BANK_NAMES: Record<string, string> = {
  rajhi: "الراجحي", snb: "الأهلي", riyad: "الرياض", sab: "الأول", anb: "العربي", alinma: "الإنماء", albilad: "البلاد", aljazira: "الجزيرة", saib: "الاستثمار", bsf: "الفرنسي",
};
function bankName(code: string) {
  return BANK_NAMES[code] ?? code;
}

function bestOf(s: Study) {
  return s.matches.filter((m) => m.verdict !== "fail").reduce((mx, m) => Math.max(mx, m.maxPrincipal), 0);
}

/** المخارج: كل مخرج يُعاد حسابه فعلياً على المحرك لإظهار أثره بالأرقام */
export function scenarios(p: Profile, products: Product[], base: Study): Scenario[] {
  const baseAmt = bestOf(base);
  const out: Scenario[] = [];
  const req = p.requestedAmount ?? 0;
  const tryIt = (key: string, title: string, q: Profile, detail: string, effort: Scenario["effort"], steps: string[]) => {
    const s = study(q, products);
    const amt = bestOf(s);
    const gain = amt - baseAmt;
    const verdictGain = rankV(s.verdict) > rankV(base.verdict);
    if (gain > 1000 || verdictGain) out.push({ key, title, detail, amount: amt, gain, verdictAfter: s.verdict, effort, steps });
  };

  // 1) سداد أو شراء كل التزام غير عقاري
  p.obligations
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.kind !== "mortgage" && o.monthly > 0)
    .sort((x, y) => (x.o.remaining ?? 1e12) - (y.o.remaining ?? 1e12))
    .slice(0, 4)
    .forEach(({ o, i }) => {
      const q = { ...p, obligations: p.obligations.filter((_, j) => j !== i) };
      const name = `${o.lender || ""} (${o.kind === "card" ? "بطاقة" : o.kind === "auto" ? "سيارة" : "شخصي"})`.trim();
      const s = study(q, products);
      const amt = bestOf(s);
      const net = o.remaining ? amt - o.remaining : null;
      const gain = amt - baseAmt;
      if (gain > 1000 || rankV(s.verdict) > rankV(base.verdict))
        out.push({
          key: `settle-${i}`,
          title: o.kind === "card" ? `إلغاء/سداد بطاقة ${o.lender ?? ""}` : `شراء مديونية ${name}`,
          detail: `يحرر ${fmt(o.monthly)} ريال من القسط الشهري.${o.remaining ? ` المتبقي ${fmt(o.remaining)} — صافي النقد بعد السداد ≈ ${fmt(net)} ريال.` : ""}`,
          amount: amt,
          gain,
          verdictAfter: s.verdict,
          effort: o.kind === "card" ? "سهل" : "متوسط",
          steps: o.kind === "card" ? ["سداد الرصيد", "طلب إلغاء البطاقة وخطاب إغلاق", "انتظار تحديث سمة"] : ["طلب خطاب مديونية محدث", "اشتراط شراء المديونية ضمن عرض الجهة الجديدة", "خطاب إخلاء طرف ونقل الراتب"],
        });
    });

  // 2) كل الالتزامات الاستهلاكية معاً (إعادة تمويل شاملة)
  const consumer = p.obligations.filter((o) => o.kind !== "mortgage" && o.monthly > 0);
  if (consumer.length > 1) {
    const remaining = consumer.reduce((s, o) => s + (o.remaining ?? 0), 0);
    tryIt("consolidate", "إعادة تمويل شاملة (دمج كل الأقساط)", { ...p, obligations: p.obligations.filter((o) => o.kind === "mortgage") }, `جهة واحدة تشتري كل المديونيات${remaining ? ` (≈ ${fmt(remaining)})` : ""} بقسط واحد أطول مدة.`, "متوسط", ["خطابات مديونية لكل الالتزامات", "عرض شراء مديونية مجمّع", "سداد مباشر من الجهة الجديدة"]);
  }

  // 3) أطول مدة متاحة
  if (p.requestedTenor) tryIt("tenor", "مدّ المدة لأقصى ما تسمح به الجهة", { ...p, requestedTenor: null }, `المدة الحالية ${p.requestedTenor} شهراً (${yrs(p.requestedTenor)} سنة). المدة الأطول تخفض القسط وترفع المبلغ، مع تكلفة أرباح أعلى.`, "سهل", ["تعديل المدة في الطلب"]);

  // 4) متضامن في العقاري
  if (p.financeType === "mortgage" && !p.coIncome) {
    const target = req > baseAmt ? req : 0;
    let need: number | null = null;
    if (target) {
      let lo = 0, hi = 60000;
      if (bestOf(study({ ...p, coIncome: hi }, products)) >= target) {
        for (let k = 0; k < 18; k++) {
          const mid = (lo + hi) / 2;
          if (bestOf(study({ ...p, coIncome: mid }, products)) >= target) hi = mid; else lo = mid;
        }
        need = Math.ceil(hi / 500) * 500;
      }
    }
    const sample = need ?? 8000;
    tryIt("co", need ? `إضافة متضامن براتب ${fmt(need)} ريال تقريباً` : "إضافة متضامن (الزوج/الزوجة)", { ...p, coIncome: sample }, need ? `هذا أقل دخل متضامن يغطي المبلغ المطلوب ${fmt(req)}.` : `مثال بدخل متضامن ${fmt(sample)} ريال. يقبل في التمويل العقاري لدى أغلب البنوك.`, "متوسط", ["تعريف راتب وكشف حساب للمتضامن", "سمة المتضامن سليمة", "إضافته في عقد التمويل"]);
  }

  // 5) الدعم السكني
  if (p.financeType === "mortgage" && p.nationality === "saudi" && !p.housingSupport)
    tryIt("sakani", "التسجيل في الدعم السكني (سكني)", { ...p, housingSupport: true }, "يرفع السقف الكلي إلى 65% للدخل حتى 15 ألف، والصندوق يدعم الأرباح.", "متوسط", ["التحقق من الاستحقاق في منصة سكني", "شهادة الاستحقاق", "اختيار منتج مدعوم"]);

  // 6) معالجة سمة
  if (p.simah === "late" || p.simah === "default")
    tryIt("simah", "تسوية سمة ثم إعادة التقديم", { ...p, simah: "clean" }, "يظهر أثر السجل النظيف. التحديث يحتاج سداداً ومخالصة وقد يستغرق حتى 30 يوماً، وبعض الجهات تشترط مدة انتظام بعدها.", "صعب", ["سداد المتأخر/المتعثر", "خطاب مخالصة", "طلب تحديث سمة", "إعادة الدراسة"]);

  // 7) التقديم بمدة تنتهي قبل التقاعد (لتجنب التدرج)
  const ret = base.matches.find((m) => m.retirement && m.retirement.after < m.installment * 0.95)?.retirement;
  if (ret && ret.atMonth >= 60) {
    const q = { ...p, requestedTenor: ret.atMonth };
    const s = study(q, products);
    const m = s.matches.find((x) => x.verdict !== "fail");
    if (m) out.push({ key: "pre-ret", title: `مدة تنتهي عند التقاعد (${yrs(ret.atMonth)} سنة)`, detail: `قسط أعلى ثابت ≈ ${fmt(m.installment)} دون انخفاض بعد التقاعد ودون اشتراطات المعاش.`, amount: bestOf(s), gain: bestOf(s) - baseAmt, verdictAfter: s.verdict, effort: "سهل", steps: ["تعديل المدة"] });
  }

  return out.sort((a, b) => b.gain - a.gain);
}

function rankV(v: Study["verdict"]) {
  return { not_eligible: 0, pending: 1, conditional: 2, eligible: 3 }[v];
}

export function deepStudy(p: Profile, products: Product[], credit?: CreditAnalysis | null): DeepStudy {
  const s = study(p, products);
  let alerts = hiddenConditions(p, s);
  if (credit) {
    // تحليل سمة الفعلي يحل محل التنبيه العام
    alerts = alerts.filter((a) => !a.id.startsWith("simah_"));
    const fmtN = (n: number) => Math.round(n).toLocaleString("en-US");
    if (credit.blockers.length)
      alerts.unshift({ id: "credit_block", level: "block", title: `سمة: ${credit.gradeLabel}`, detail: credit.blockers.join(" • "), exit: credit.actions.slice(0, 3).join(" ثم "), source: "تحليل تقرير سمة" });
    else if (credit.grade !== "A")
      alerts.unshift({ id: "credit_warn", level: "warn", title: `سمة: ${credit.gradeLabel}`, detail: credit.findings.filter((f) => f.level === "warn").map((f) => f.text).join(" • ") || "ملاحظات على السجل", exit: credit.actions[0], source: "تحليل تقرير سمة" });
    if (credit.stats.financeCoDefaults > 0)
      alerts.push({ id: "credit_fc", level: "warn", title: "تعثر لدى شركة تمويل", detail: "البنوك تقرأ تعثر شركات التمويل أسوأ من تعثر البنك وتطلب مهلة أطول بعد السداد.", exit: "سدّد واحصل على مخالصة، ثم ابدأ بالجهات الأكثر مرونة.", source: "ممارسة سوق" });
    if (credit.stats.totalToClear > 0)
      alerts.push({ id: "credit_clear", level: "info", title: `المطلوب لتنظيف السجل ≈ ${fmtN(credit.stats.totalToClear)} ريال`, detail: "مجموع قرارات التنفيذ والتعثرات القائمة دون احتساب الدين مرتين.", source: "تحليل تقرير سمة" });
  }
  const sc = scenarios(p, products, s);
  const baseAmount = bestOf(s);
  // المخارج تُضاف للتوصيات بصيغة مختصرة
  const recs = [...s.recommendations];
  if (sc[0] && sc[0].gain > 0) recs.splice(1, 0, `أقوى مخرج لرفع المبلغ: ${sc[0].title} (+${fmt(sc[0].gain)} ريال).`);
  if (alerts.some((x) => x.level === "block")) recs.unshift("⛔ يوجد مانع يجب معالجته قبل أي تقديم — راجع التنبيهات.");
  const blocked = !!credit && credit.grade === "E";
  if (blocked) recs.unshift("المبالغ أدناه هي قدرة العميل بعد رفع الموانع الائتمانية، لا قبلها.");
  return { ...s, verdict: blocked ? "not_eligible" : s.verdict, headline: blocked ? "متوقف حالياً — موانع ائتمانية يجب رفعها أولاً" : s.headline, recommendations: recs, alerts, scenarios: sc, baseAmount, credit: credit ?? null };
}

export type { Match };
