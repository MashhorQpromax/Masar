// تمويل المشاريع والتطوير العقاري (فندق، سكني، تجاري) — دراسة هيكلية لا تعتمد على الراتب.
// المنطق: التمويل يُبنى على قيمة الأصل وتكلفة المشروع وتدفقه النقدي، لا على الاستقطاع.
// النسب تقديرية من ممارسة السوق السعودي وتُعدّل من خبرة الفريق.

export interface ProjectInput {
  borrowerType?: "individual" | "company" | null;
  city?: string | null;
  district?: string | null;
  landArea?: number | null; // م²
  landValue?: number | null; // تقييم الأرض
  valuer?: string | null;
  valuationDate?: string | null;
  deed?: "registered" | "electronic" | "paper" | null; // registered = له رقم هوية عقارية (السجل العقاري)
  projectType?: "hotel" | "residential" | "commercial" | "mixed" | null;
  purpose?: "build" | "cashout" | "build_cashout" | null;
  constructionCost?: number | null;
  gfa?: number | null; // مسطحات البناء م²
  keys?: number | null; // غرف الفندق
  adr?: number | null; // متوسط سعر الغرفة لليلة
  occupancy?: number | null; // %
  equityCash?: number | null; // سيولة يضخها المالك
  nearHaram?: boolean | null;
  hasPermit?: boolean | null;
  hasFeasibility?: boolean | null;
  existingLien?: boolean | null;
}

export interface Structure {
  id: string;
  title: string;
  fit: "high" | "medium" | "low";
  amount: number | null; // مبلغ تقديري ممكن
  how: string;
  needs: string[];
  lenders: string[];
}

export interface ProjectStudy {
  requested: number;
  totalCost: number | null;
  ltv: number | null; // المطلوب ÷ قيمة الأرض
  ltc: number | null; // المطلوب ÷ (الأرض + البناء)
  equityPct: number | null;
  pricePerM2: number | null;
  cashoutPart: number | null; // ما يزيد عن تكلفة البناء
  noi: number | null;
  dscr: number | null;
  verdict: "feasible_restructure" | "feasible" | "needs_info" | "weak";
  headline: string;
  alerts: { level: "block" | "warn" | "info"; title: string; detail: string; exit?: string }[];
  structures: Structure[];
  missing: { label: string; why: string; critical: boolean }[];
}

const M = (n: number) => `${(Math.round(n / 100_000) / 10).toLocaleString("en-US")} مليون`;

export function projectStudy(x: ProjectInput, requested: number): ProjectStudy {
  const land = x.landValue ?? 0;
  const cc = x.constructionCost ?? 0;
  const totalCost = land && cc ? land + cc : null;
  const ltv = land ? Math.round((requested / land) * 1000) / 10 : null;
  const ltc = totalCost ? Math.round((requested / totalCost) * 1000) / 10 : null;
  const equityPct = totalCost ? Math.round(((land + (x.equityCash ?? 0)) / totalCost) * 1000) / 10 : null;
  const pricePerM2 = land && x.landArea ? Math.round(land / x.landArea) : null;
  const cashoutPart = cc ? Math.max(0, requested - cc) : null;

  // دخل تشغيلي تقديري للفندق
  let noi: number | null = null, dscr: number | null = null;
  if (x.projectType === "hotel" && x.keys && x.adr && x.occupancy) {
    const rooms = x.keys * x.adr * 365 * (x.occupancy / 100);
    const revenue = rooms * 1.15; // أغذية وخدمات ≈ 15% إضافية
    noi = Math.round(revenue * 0.4); // هامش تشغيلي ≈ 40% لفنادق المنطقة المركزية (تقديري)
    const r = 0.075 / 12, n = 120;
    const ds = requested * (r / (1 - Math.pow(1 + r, -n))) * 12; // 10 سنوات بعد فترة السماح
    dscr = Math.round((noi / ds) * 100) / 100;
  }

  const alerts: ProjectStudy["alerts"] = [];
  const missing: ProjectStudy["missing"] = [];
  const need = (label: string, why: string, critical = true) => missing.push({ label, why, critical });

  if (x.deed !== "registered")
    alerts.push({ level: "block", title: "الصك بلا رقم هوية عقارية", detail: "البنوك ترهن عبر السجل العقاري؛ الصك غير المسجل يؤخر الرهن أو يمنعه في المناطق التي بدأ فيها التسجيل العيني.", exit: "تسجيل العقار في السجل العقاري (rer.sa) أو تحديث الصك إلكترونياً قبل التقديم." });
  if (x.nearHaram)
    alerts.push({ level: "warn", title: "المنطقة المركزية قرب الحرم", detail: "تحقق من عدم شمول القطعة بمشاريع نزع ملكية أو تطوير، ومن اشتراطات الارتفاعات والاستخدام، وأن التملك والتمويل يخضعان لقيود المدينة المنورة (المالك سعودي).", exit: "خطاب من أمانة المدينة/هيئة تطوير المدينة بحالة القطعة واشتراطات البناء." });
  if (x.borrowerType !== "company")
    alerts.push({ level: "warn", title: "المقترض فرد", detail: "تمويل التطوير والفنادق يُمنح عادة لمنشأة بسجل تجاري وقوائم مالية، وقد يُقبل فرد بضمان شخصي وأصل قوي عبر منشأة جديدة.", exit: "تأسيس شركة مشروع (SPV) وإدخال الأرض حصة عينية، والمالك كفيل." });
  if (land && pricePerM2 && pricePerM2 > 100_000)
    alerts.push({ level: "warn", title: `سعر المتر ${pricePerM2.toLocaleString("en-US")} ريال`, detail: "البنك يقيّم بمقيّمَين من قائمته المعتمدة ويأخذ الأقل؛ تقييم السوق المرتفع قد ينخفض كثيراً، فتنخفض نسبة التمويل.", exit: "تقييم مبدئي ثانٍ من مقيّم معتمد لدى البنك المستهدف قبل الوعد بأي مبلغ." });
  if (ltv != null && ltv > 50 && (x.purpose === "cashout" || x.purpose === "build_cashout"))
    alerts.push({ level: "warn", title: `نسبة الطلب ${ltv}% من قيمة الأرض`, detail: "التمويل النقدي مقابل أرض خام لا يتجاوز عادة 40–50% من تقييم البنك، وأي مبلغ يتجاوز تكلفة البناء يحتاج مبرراً ومصدر سداد واضحاً.", exit: "فصل الطلب: تمويل بناء يُصرف على مراحل + تمويل نقدي محدود بضمان الأرض." });
  if (cashoutPart && cashoutPart > 0)
    alerts.push({ level: "info", title: `≈ ${M(cashoutPart)} من الطلب يزيد على تكلفة البناء`, detail: "البنك سيسأل عن استخدام الفائض. يجب تحديد الغرض (سداد التزامات، تجهيز وتشغيل، احتياطي).", exit: "خطة استخدام الأموال (Sources & Uses) موقعة." });
  if (x.existingLien) alerts.push({ level: "warn", title: "رهن قائم على الأرض", detail: "يلزم فكه أو شراؤه من الجهة الجديدة.", exit: "خطاب مخالصة/مبلغ السداد من المرتهن الحالي." });
  if (dscr != null && dscr < 1.25) alerts.push({ level: "warn", title: `تغطية خدمة الدين ${dscr}x`, detail: "البنوك تطلب عادة 1.25x فأكثر.", exit: "خفض المبلغ أو إطالة المدة أو زيادة رأس المال." });

  // ===== النواقص =====
  if (!x.borrowerType) need("هوية المقترض: فرد أم شركة (السجل التجاري)", "يحدد الجهات والمنتج");
  need("صورة الصك وما يثبت رقم الهوية العقارية (السجل العقاري)", "شرط الرهن", x.deed !== "registered");
  if (!x.constructionCost) need("تكلفة البناء التقديرية (BOQ) من مكتب هندسي", "أساس تمويل البناء");
  if (!x.gfa) need("المسطحات المسموحة وعدد الأدوار حسب اشتراطات الأمانة", "يحدد حجم المشروع وقيمته");
  if (x.projectType === "hotel" && !x.keys) need("عدد الغرف (المفاتيح) المخطط", "أساس الدخل التشغيلي");
  if (!x.hasFeasibility) need("دراسة جدوى من مكتب معتمد (إيرادات، تشغيل، تدفق نقدي)", "تطلبها كل الجهات للمشاريع");
  if (!x.hasPermit) need("رخصة البناء أو خطاب اشتراطات البناء", "لا يُصرف تمويل بناء دون رخصة");
  need("تقرير التقييم الكامل (اسم المقيّم ورقم ترخيص تقييم وتاريخه)", "البنك يعيد التقييم لكن يحتاجه للمبدئي", !x.valuer);
  need("كشف حساب 12 شهراً + القوائم المالية إن كانت شركة", "الملاءة والسيولة");
  need("تقرير سمة للمالك (وسمة تجارية للشركة)", "شرط أساسي");
  need("بيان رأس المال المتاح للمالك (سيولة يضخها)", "البنوك تطلب مساهمة نقدية 20–30% من تكلفة البناء غالباً", !x.equityCash);
  need("خطة استخدام المبلغ (Sources & Uses)", "تبرير الـ 160 مليون مقابل تكلفة البناء", true);
  if (x.projectType === "hotel") need("خطاب نوايا من مشغل فندقي أو عقد تأجير مسبق مع شركة حج وعمرة", "يرفع قبول البنك وصندوق التنمية السياحي كثيراً", false);
  if (x.nearHaram) need("إفادة من الأمانة بعدم وجود نزع ملكية/مشروع تطوير على القطعة", "حماية الضمان", true);

  // ===== الهياكل الممكنة =====
  const structures: Structure[] = [];
  const devAmount = totalCost ? Math.min(requested, Math.round(totalCost * 0.6)) : cc ? Math.round(cc * 0.7) : null;
  structures.push({
    id: "dev", title: "تمويل تطوير من بنك (الأرض حصة المالك)", fit: x.borrowerType === "company" || cc ? "high" : "medium", amount: devAmount,
    how: "البنك يموّل 60–70% من تكلفة المشروع الكلية (أرض + بناء)، وتُحسب الأرض مساهمةً من المالك. الصرف على دفعات حسب نسبة الإنجاز بإشراف استشاري، وفترة سماح أثناء البناء، ثم سداد من دخل الفندق.",
    needs: ["شركة مشروع بسجل تجاري", "رخصة بناء", "دراسة جدوى", "مقاول مصنف وعقد مقاولة", "تقييم من مقيّمي البنك", "رهن الأرض والمشروع"],
    lenders: ["مصرف الراجحي (الشركات)", "البنك الأهلي السعودي (تمويل المشاريع)", "بنك الرياض", "مصرف الإنماء", "البنك السعودي الفرنسي", "بنك البلاد"],
  });
  if (x.projectType === "hotel")
    structures.push({
      id: "tdf", title: "صندوق التنمية السياحي + بنك", fit: "high", amount: totalCost ? Math.round(totalCost * 0.6) : null,
      how: "الصندوق يموّل مشاريع الضيافة مباشرة أو بالشراكة مع بنك (تمويل مشترك)، بشروط أيسر وفترة سماح أطول. المدينة المنورة من الوجهات المستهدفة. النسب والسقوف تُتحقق من الصندوق مباشرة.",
      needs: ["دراسة جدوى سياحية", "مشغل أو علامة فندقية", "ترخيص من وزارة السياحة", "مساهمة المالك (الأرض + سيولة)"],
      lenders: ["صندوق التنمية السياحي (TDF)", "بالشراكة مع أحد البنوك أعلاه"],
    });
  structures.push({
    id: "cashout", title: "تمويل نقدي بضمان الأرض", fit: x.deed === "registered" ? "medium" : "low", amount: land ? Math.round(land * 0.45) : null,
    how: "رهن الأرض مقابل تمويل نقدي ≈ 40–50% من تقييم البنك (لا تقييم العميل). مناسب لجزء السيولة، لكنه يحتاج مصدر سداد واضح (دخل آخر أو بيع).",
    needs: ["صك مسجل", "تقييم البنك", "مصدر سداد مثبت", "ضمانات شخصية"],
    lenders: ["البنوك التجارية (قطاع الشركات)", "شركات التمويل العقاري (بنسب أقل وتكلفة أعلى)"],
  });
  structures.push({
    id: "jv", title: "شراكة مع مطوّر (الأرض مقابل حصة)", fit: "medium", amount: null,
    how: "المالك يقدم الأرض، والمطوّر يموّل ويبني ويشغّل، ويتقاسمان الدخل أو الوحدات. لا دين على المالك، لكنه يتنازل عن جزء من العائد.",
    needs: ["تقييم متفق عليه", "عقد شراكة محكم", "سجل المطوّر"], lenders: ["مطوّرو الضيافة في المدينة المنورة", "شركات تشغيل فندقي"],
  });
  structures.push({
    id: "fund", title: "صندوق استثمار عقاري (هيئة السوق المالية)", fit: requested >= 50_000_000 ? "medium" : "low", amount: null,
    how: "مدير صندوق مرخص ينشئ صندوقاً خاصاً تُدخل فيه الأرض حصة عينية، ويجمع باقي التكلفة من مستثمرين ويقترض باسم الصندوق.",
    needs: ["مدير صندوق مرخص", "تقييمان معتمدان", "حجم مشروع كبير"], lenders: ["شركات إدارة الأصول المرخصة"],
  });
  if (x.projectType === "hotel")
    structures.push({
      id: "prelease", title: "تأجير مسبق لشركة حج وعمرة/مشغل", fit: "medium", amount: null,
      how: "عقد تأجير طويل قبل البناء يحول المشروع لدخل مضمون؛ يمكن خصم العقد لدى البنك أو استخدامه ضماناً، ويرفع نسبة التمويل.",
      needs: ["عقد تأجير موثق", "ملاءة المستأجر"], lenders: ["البنوك (خصم الإيجارات)"],
    });

  const critical = missing.filter((m) => m.critical).length;
  const verdict: ProjectStudy["verdict"] = critical >= 4 ? "needs_info" : (ltv ?? 0) > 70 ? "weak" : (cashoutPart ?? 0) > 0 || (ltv ?? 0) > 50 ? "feasible_restructure" : "feasible";
  const headline = {
    needs_info: "قابل للدراسة، نحتاج النواقص الأساسية قبل الحكم",
    feasible_restructure: "ممكن بعد إعادة هيكلة الطلب (بناء على مراحل + سيولة محدودة)",
    feasible: "ممكن بالهيكل المقترح",
    weak: "ضعيف بصيغته الحالية، يحتاج رأس مال أو شريك",
  }[verdict];

  return { requested, totalCost, ltv, ltc, equityPct, pricePerM2, cashoutPart, noi, dscr, verdict, headline, alerts, structures, missing };
}
