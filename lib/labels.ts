// تسميات عربية موحدة لكل القيم — تتبع مفاتيح نظام المجلدات السابق
export const STATUS = {
  study: { label: "قيد الدراسة", tone: "amber", emoji: "🟡" },
  awaiting_docs: { label: "بانتظار مستندات", tone: "orange", emoji: "🟠" },
  submitted: { label: "مقدم للجهة", tone: "blue", emoji: "🔵" },
  approved: { label: "معتمد / تم الصرف", tone: "green", emoji: "🟢" },
  rejected: { label: "مرفوض / متوقف", tone: "red", emoji: "🔴" },
} as const;
export type StatusKey = keyof typeof STATUS;
export const STATUS_ORDER: StatusKey[] = ["study", "awaiting_docs", "submitted", "approved", "rejected"];

export const ELIGIBILITY = {
  eligible: { label: "مؤهل", tone: "green", emoji: "✅" },
  conditional: { label: "مؤهل بشروط", tone: "amber", emoji: "⚠️" },
  not_eligible: { label: "غير مؤهل حالياً", tone: "red", emoji: "❌" },
  pending: { label: "لم يحدد", tone: "slate", emoji: "⏳" },
} as const;
export type EligibilityKey = keyof typeof ELIGIBILITY;

export const FINANCE_TYPE = {
  personal: "تمويل شخصي",
  mortgage: "تمويل عقاري",
  auto: "تمويل تأجيري (سيارة)",
  sme: "تمويل منشآت",
  card: "بطاقة ائتمانية",
} as const;

export const SECTOR = {
  gov: "حكومي (مدني)",
  military: "عسكري",
  semi_gov: "شبه حكومي",
  private_approved: "خاص معتمد",
  private: "خاص غير معتمد",
  retired: "متقاعد",
  self: "صاحب عمل حر",
} as const;

export const SIMAH = {
  clean: "سليم",
  late: "تأخر سداد",
  default: "متعثر",
  unknown: "غير معروف",
} as const;

export const OBLIGATION_KIND = {
  personal: "شخصي",
  mortgage: "عقاري",
  auto: "سيارة",
  card: "بطاقة ائتمانية",
  other: "أخرى",
} as const;

export const DOC_STATUS = {
  missing: { label: "غير مستلم", tone: "slate" },
  received: { label: "مستلم", tone: "blue" },
  verified: { label: "تم التحقق", tone: "green" },
  rejected: { label: "مرفوض / يعاد", tone: "red" },
} as const;

export const DOC_CATEGORY = {
  identity: "الهوية والشخصية",
  income: "الدخل والعمل",
  obligations: "الالتزامات والسمة",
  collateral: "الضمانات والعقار",
  business: "مستندات المنشأة",
} as const;

export const APP_STATUS = {
  draft: { label: "مسودة", tone: "slate" },
  submitted: { label: "مقدم", tone: "blue" },
  under_review: { label: "قيد المراجعة", tone: "amber" },
  more_info: { label: "طلب استيفاء", tone: "orange" },
  approved: { label: "موافقة", tone: "green" },
  disbursed: { label: "تم الصرف", tone: "green" },
  rejected: { label: "مرفوض", tone: "red" },
  withdrawn: { label: "مسحوب", tone: "slate" },
} as const;

export const NOTE_KIND = {
  note: "ملاحظة",
  call: "مكالمة",
  whatsapp: "واتساب",
  email: "بريد",
  meeting: "اجتماع",
} as const;

export const BANKS: Record<string, string> = {
  rajhi: "مصرف الراجحي",
  snb: "البنك الأهلي السعودي",
  riyad: "بنك الرياض",
  sab: "البنك السعودي الأول (ساب)",
  alinma: "مصرف الإنماء",
  albilad: "بنك البلاد",
  aljazira: "بنك الجزيرة",
  anb: "البنك العربي الوطني",
  bsf: "البنك السعودي الفرنسي",
  saib: "البنك السعودي للاستثمار",
  other: "أخرى",
};

export const AUDIT_ACTION: Record<string, string> = {
  login: "تسجيل دخول",
  login_failed: "محاولة دخول فاشلة",
  logout: "تسجيل خروج",
  client_create: "إنشاء ملف عميل",
  client_update: "تعديل بيانات عميل",
  client_status: "تغيير حالة",
  client_view_pii: "عرض الهوية كاملة",
  client_delete: "حذف ملف عميل",
  obligation_add: "إضافة التزام",
  obligation_delete: "حذف التزام",
  doc_upload: "رفع مستند",
  doc_download: "تنزيل مستند",
  doc_status: "تحديث حالة مستند",
  app_create: "إنشاء طلب لجهة",
  app_update: "تحديث طلب",
  note_add: "إضافة ملاحظة",
  study_save: "اعتماد دراسة",
  user_create: "إنشاء مستخدم",
  user_update: "تعديل مستخدم",
  product_update: "تعديل منتج تمويلي",
  product_create: "إضافة منتج تمويلي",
  export: "تصدير",
};
