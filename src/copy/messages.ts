/**
 * The messages the office sends about a deal, as WhatsApp reads them: plain text, *bold* and _soft_,
 * no pictures and no decoration.
 *
 * The three messages for the client are built from `ClientFacts` alone. That type carries no fee, no
 * capital and no return, so nothing written here can tell a client what the company earns.
 */
import { splitLabel, STATIONS, type DealInput, type DealStudy, type LenderKind, type Stage, type StationKey, type StationState } from "@/domain/deal";
import type { ClientFacts, GateReason, MessageKind } from "@/domain/messages";
import { LINK_DAYS } from "@/domain/messages";
import { STRUCTURE } from "./deal";
import { owedLines } from "./documents";
import { counted, dayShort, plainMoney, type CountForms } from "./format";

/** The name the office signs with. */
export const OFFICE_NAME = "مسار للحلول التمويلية";

export const MESSAGE_KIND: Record<MessageKind, { label: string; hint: string }> = {
  study: { label: "ملخص الدراسة", hint: "للعميل: الجهة التي وجدناها، الحل، وما يبقى له." },
  papers: { label: "طلب المستندات", hint: "للعميل: ما ينقص ملفه ورابط الرفع." },
  progress: { label: "أين وصل الملف", hint: "للعميل: المرحلة الحالية وما بعدها." },
  reply: { label: "رد بكلماتك", hint: "للعميل: جواب على ما كتبه." },
  internal: { label: "ملخص داخلي", hint: "لشريك أو ممول: فيه أتعابنا ورأس المال." },
};

/** Why a message is closed, said to the person who wanted to send it. */
export const GATE_REASON: Record<GateReason, string> = {
  REJECTED: "الصفقة ملغاة، فلا نراسل العميل. أعد فتحها من ملف الصفقة إن تغيّر الوضع.",
  DEFICIT: "الصفقة لا تُغلق بأرقامها الحالية، فالعميل بحكم المرفوض ولا نراسله. حسّن الأرقام أو ألغِ الصفقة.",
  STUDY_OPEN: "الدراسة لم تكتمل بعد، فالمتاح للعميل طلب المستندات والرد عليه.",
};

/** The road as the client hears it: six steps, in their words. */
export const CLIENT_STEP: Record<StationKey, string> = {
  study: "دراسة الملف والاتفاق",
  settle: "تسوية الالتزامات والمتعثرات",
  credit: "تحديث سجلك في سمة",
  property: "مخالصة العقار وتجهيزه",
  bank: "التقديم للجهة والموافقة",
  payout: "صرف التمويل",
};

/** What is happening now, said to the client. */
export const CLIENT_NOW: Record<Stage, string> = {
  study: "نراجع ملفك ونجهز لك العرض النهائي.",
  agreement: "بعد التوقيع نبدأ مباشرة بتسوية الالتزامات.",
  settlement: "نسدد القرارات والمتعثرات ونتابع رفع الإيقاف.",
  clearance: "نستلم خطابات المخالصة ونتأكد من رفع الإيقاف.",
  simah_update: "ننتظر تحديث سمة، ويأخذ عادة من أسبوع إلى أسبوعين.",
  payoff: "نُنهي مخالصة التمويل العقاري مع البنك.",
  transfer: "نُنهي إجراءات العقار تمهيداً للتقديم للجهة.",
  bank_submit: "رفعنا طلبك للجهة، وستتواصل معك للتوقيع والتقييم.",
  approval: "الجهة تدرس الطلب وتقيّم العقار.",
  disbursement: "صدرت الموافقة، ونُنهي إجراءات الصرف.",
  recovered: "اكتملت العملية بحمد الله.",
  closed: "اكتملت العملية بحمد الله.",
  lost: "توقف العمل على الملف.",
};

const LENDER_KIND: Record<LenderKind, string> = {
  bank: "بنك محلي",
  finance_co: "شركة تمويل مرخصة من البنك المركزي",
};

const PART: Record<"mortgage" | "personal", string> = { mortgage: "عقاري", personal: "شخصي" };

/** An amount as a person says it: rounded, never to the riyal. */
export function about(amount: number): string {
  if (amount >= 1_000_000) return `${(Math.round(amount / 10_000) / 100).toLocaleString("en-US")} مليون`;
  if (amount >= 10_000) return plainMoney(Math.round(amount / 1000) * 1000);
  return plainMoney(amount);
}

const WEEKS = { one: "أسبوع", two: "أسبوعين", few: "أسابيع", many: "أسبوعاً" };

/** The first name of a full name. */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? "";

/** What a message needs besides the deal's facts. */
export interface MessageExtras {
  /** The client's first name. */
  first: string;
  /** Who writes. Null signs as the team. */
  staff: string | null;
  /** The client's own papers still owed. */
  owed: { label: string; note: string | null }[];
  /** The client's link, when the message carries it. */
  link: string | null;
  /** Name the lender. Off by default: a client who knows the lender can go to it without us. */
  nameLender?: boolean;
}

function greeting(x: MessageExtras): string {
  const who = x.staff ? `معك ${x.staff} من *${OFFICE_NAME}*.` : `معك فريق *${OFFICE_NAME}*.`;
  return `السلام عليكم ورحمة الله${x.first ? ` ${x.first}` : ""}\n${who}`;
}

function closing(x: MessageExtras): string {
  const parts: string[] = [];
  if (x.link) parts.push(`*رابط ملفك للمتابعة ورفع المستندات:*\n${x.link}\n_رابط خاص بك، صالح ${LINK_DAYS} يوماً._`);
  parts.push("أي استفسار أنا حاضر هنا.");
  return parts.join("\n\n");
}

/** The lender found for the client, as the opening of the study message. Null when none was chosen. */
function found(facts: ClientFacts, nameLender: boolean): string | null {
  const parts = facts.financing.filter((part) => part.lender);
  if (parts.length === 0) return null;
  const total = facts.financing.reduce((sum, part) => sum + part.amount, 0);
  const names = [...new Set(parts.map((part) => part.lender))];
  const two = names.length > 1;
  const first = parts[0]!;
  const who = nameLender ? names.map((name) => `*${name}*`).join(" و") : two ? "جهتان معتمدتان" : (first.lenderKind ? LENDER_KIND[first.lenderKind] : "جهة معتمدة");
  const amount = `*${about(total)}* ريال`;
  if (facts.offered) {
    return two
      ? `*بشارة: صدر عرض تمويلك*\nحصلنا لك على عرضين من جهتين تمويليتين (${who}) بمجموع ${amount}.`
      : `*بشارة: صدر عرض تمويلك*\nحصلنا لك على عرض من جهة تمويلية (${who}) بمبلغ ${amount}.`;
  }
  return two
    ? `*بشارة: وفرنا لك جهتين تمويليتين*\nبعد دراسة ملفك وجدنا لك جهتين (${who}) تمولانك بما يصل إلى ${amount}.`
    : `*بشارة: وفرنا لك جهة تمويلية*\nبعد دراسة ملفك وجدنا لك جهة (${who}) تمولك بما يصل إلى ${amount}.`;
}

/** Beside a figure the client is told that is counted from general terms, not written by the lender. */
export const ESTIMATE_MARK = "(تقديري)";
/** Under the figures, when any of them is an estimate. */
export const ESTIMATE_NOTE = "ما عُلّم «تقديري» محسوب من الشروط العامة، ويثبت بعد موافقة الجهة والتقييم الرسمي.";

/** Whether anything the client is told about their money is an estimate. */
export function hasEstimate(facts: Pick<ClientFacts, "financing" | "keeps" | "keepsCertainty">): boolean {
  return facts.financing.some((part) => part.certainty === "estimated") || (facts.keeps > 0 && facts.keepsCertainty === "estimated");
}

/** A holder written without its name reads as the one the client knows: "the bank". */
const HOLDER: Record<string, string> = { بنك: "البنك", "شركة تمويل": "شركة التمويل" };
const holder = (name: string): string => HOLDER[name] ?? name;

/** What the study found, for the client: the lender, the plan, and what they end with. */
export function studyText(facts: ClientFacts, x: MessageExtras): string {
  const opening = found(facts, x.nameLender ?? false);
  const out = [greeting(x), opening ?? "أنهينا دراسة ملفك، وهذه خلاصتها:"];

  const plan: string[] = [];
  if (facts.settles > 0) plan.push(`نسدد عنك المتعثرات وقرارات التنفيذ، ومجموعها نحو ${about(facts.settles)} ريال.`);
  if (facts.payoff > 0) plan.push(`نُنهي مخالصة تمويلك الحالي${facts.payoffAt.length ? ` لدى ${facts.payoffAt.map(holder).join(" و")}` : ""}.`);
  plan.push("نحدّث سجلك في سمة بعد السداد.");
  const kinds = facts.financing.map((part) => PART[part.part]).join(" و");
  plan.push(`نتقدم لك بتمويل ${kinds || "جديد"}${kinds ? " جديد" : ""}.`);
  out.push(`*الحل*\n${plan.map((line, index) => `${index + 1}. ${line}`).join("\n")}`);

  // A figure from the lender's written offer is said as it is. A counted one is said as near, and marked.
  const ends = facts.financing.map((part) =>
    part.certainty === "confirmed"
      ? `- تمويل ${PART[part.part]} *${plainMoney(part.amount)}* ريال، بعرض مكتوب من الجهة`
      : `- تمويل ${PART[part.part]} نحو *${about(part.amount)}* ريال ${ESTIMATE_MARK}`,
  );
  if (facts.keeps > 0) {
    ends.push(
      facts.keepsCertainty === "confirmed"
        ? `- يبقى لك نقداً بعد سداد كل التزاماتك *${plainMoney(facts.keeps)}* ريال`
        : `- يبقى لك نقداً بعد سداد كل التزاماتك نحو *${about(facts.keeps)}* ريال ${ESTIMATE_MARK}`,
    );
  }
  if (ends.length) out.push(`*المتوقع لك*\n${ends.join("\n")}`);

  out.push(`*المدة:* من ${facts.weeks.from} إلى ${counted(facts.weeks.to, WEEKS)} تقريباً.`);
  if (x.owed.length) out.push(`*${opening ? "المطلوب لتثبيت العرض" : "المطلوب منك الآن"}*\n${owedLines(x.owed.slice(0, 8)).join("\n")}`);
  if (hasEstimate(facts)) out.push(`_${ESTIMATE_NOTE}_`);
  out.push(closing(x));
  return out.join("\n\n");
}

/** The papers still owed, for the client. It names papers and nothing about the deal. */
export function papersText(x: MessageExtras): string {
  const out = [greeting(x)];
  if (x.owed.length === 0) {
    out.push("وصلتنا كل مستنداتك، شكراً لتعاونك.\nنكمل الآن على ملفك ونبلغك بكل جديد.");
  } else {
    out.push(`لنكمل ملفك بأسرع وقت نحتاج منك:\n\n${owedLines(x.owed).join("\n")}`);
    out.push(x.link ? "ارفعها من الرابط بالأسفل صوراً واضحة أو ملفات PDF، أو أرسلها هنا." : "أرسلها هنا صوراً واضحة أو ملفات PDF.");
  }
  out.push(closing(x));
  return out.join("\n\n");
}

/** Where the file stands, for the client: the six steps with the current one marked. */
export function progressText(facts: ClientFacts, steps: readonly { key: StationKey; state: StationState }[], x: MessageExtras): string {
  const out = [greeting(x)];
  const lines = steps.map((step, index) => {
    const title = CLIENT_STEP[step.key];
    if (step.state === "current") return `${index + 1}. *${title}* (الآن)`;
    return `${index + 1}. ${title}${step.state === "done" ? " (تم)" : ""}`;
  });
  out.push(`*أين وصل ملفك*\n\n${lines.join("\n")}`);
  out.push(`*الآن:* ${CLIENT_NOW[facts.stage]}`);
  if (x.owed.length) out.push(`ما زال ينقصنا: ${x.owed.slice(0, 4).map((paper) => paper.label).join("، ")}.`);
  out.push(closing(x));
  return out.join("\n\n");
}

const COST: Record<DealStudy["summary"]["costs"][number]["kind"], string> = {
  admin_fee: "الرسوم الإدارية للتمويل",
  transfer_tax: "ضريبة التصرفات عند الإفراغ لطرفنا",
  sale_tax: "ضريبة البيع للبنك",
  fixed_costs: "التقييم والسعي والرسوم",
};

const plainLabel = (label: string): string => {
  const { title, party } = splitLabel(label);
  return party ? `${title} (${party})` : title;
};

const pct = (value: number): string => {
  const share = Number(value) || 0;
  return `${Number.isInteger(share) ? share : share.toFixed(1)}%`;
};

/**
 * The deal in the company's own numbers, for a partner or a funder. It carries the fee and the
 * capital, so it is never offered as a message to the client.
 */
export function internalText(deal: { clientName: string; fileNo: string; input: DealInput; study: DealStudy }): string {
  const { study, input } = deal;
  const sum = study.summary;
  const n = plainMoney;
  const out = [`*ملخص صفقة، داخلي*\n${deal.clientName} · ${deal.fileNo}\nالهيكل: ${STRUCTURE[study.structure]}`];

  const dues = sum.obligations.map((due) => {
    const how = due.byBank ? " _(تشتريه جهة التمويل الجديدة)_" : due.original > due.amount + 1 ? ` _(بعد خصم من ${n(due.original)})_` : "";
    return `- ${plainLabel(due.label)}: ${n(due.amount)}${how}`;
  });
  const kept = sum.kept.length
    ? `\n_يبقى خارج الصفقة: ${sum.kept.map((item) => `${plainLabel(item.label)}${item.monthly ? ` بقسط ${n(item.monthly)} شهرياً` : item.amount ? ` (${n(item.amount)})` : ""}`).join("، ")}_`
    : "";
  const saved = sum.discountTotal > 0 ? `\n_وفّرنا بالتفاوض: ${n(sum.discountTotal)}_` : "";
  out.push(`*1) ما يُسدَّد*\n${dues.join("\n")}\n*الإجمالي: ${n(sum.totalObligations)}*${saved}${kept}`);

  const financing = sum.financing.map((part) => `- ${PART[part.kind]}${part.lender ? ` (${part.lender})` : ""}: ${n(part.amount)}`);
  out.push(`*2) التمويل الجديد*\n${financing.join("\n")}${sum.financing.length > 1 ? `\n*الإجمالي: ${n(sum.totalFinancing)}*` : ""}`);

  const after = [`التمويل ${n(sum.totalFinancing)}`, `ناقص الالتزامات ${n(sum.totalObligations)}`, ...sum.costs.map((cost) => `ناقص ${COST[cost.kind]} ${n(cost.amount)}`)];
  out.push(`*3) بعد السداد*\n${after.join("\n")}\n${sum.afterSettle >= 0 ? `= يتبقى *${n(sum.afterSettle)}*` : `= ينقص *${n(-sum.afterSettle)}*`}`);

  const fee = [`- على السداد ${pct(input.fee.settlePct)}: ${n(study.feeSettle)}`, `- على التمويل ${pct(input.fee.financePct)}: ${n(study.feeFinance)}`];
  if (study.feeFixed > 0) fee.push(`- مقطوع: ${n(study.feeFixed)}`);
  out.push(`*4) أتعابنا*\n${fee.join("\n")}\n*الإجمالي: ${n(study.fee)}*`);

  out.push(`*5) النتيجة*\n${sum.net >= 0 ? `*يبقى للعميل ${n(sum.net)} ريال* بعد أتعابنا.` : `*عجز ${n(-sum.net)} ريال.*`}`);

  const tail = [`رأس المال الذي ندفعه مؤقتاً: ${n(study.capital)}`, `المدة نحو ${counted(study.days, { one: "يوم واحد", two: "يومين", few: "أيام", many: "يوماً" })}`];
  if (study.cover) tail.push(`تغطية الضمان ${study.cover}x`);
  out.push(tail.join(" · "));
  if (sum.keptExecutions > 0) out.push(`تنبيه: قرارات تنفيذ خارج الصفقة بمبلغ ${n(sum.keptExecutions)}. الإيقاف لا يرتفع إلا بسدادها كلها.`);
  return out.join("\n\n");
}

/** Every station a deal can pass, for a caller that needs the client's wording of each. */
export const CLIENT_STEP_KEYS = STATIONS.map((station) => station.key);

const MESSAGE_ERROR: Record<string, string> = {
  DEMO: "هذا عرض ببيانات وهمية. الإرسال يعمل مع البيانات الحقيقية.",
  WA_OFF: "الإرسال من رقم الشركة لم يُفعَّل بعد. افتح الرسالة في واتساب وأرسلها من جوالك.",
  NO_PHONE: "رقم جوال العميل غير مسجل أو غير صالح. صحّحه في ملف العميل.",
  GATE_CLOSED: "هذه الرسالة غير متاحة لهذا الملف الآن.",
  MESSAGE_EMPTY: "اكتب الرسالة أولاً.",
  SEND_FAILED: "لم تصل الرسالة إلى واتساب. حاول مرة أخرى.",
  NO_SITE: "عنوان الموقع غير مضبوط، فلا يُبنى رابط العميل. اضبط MASAR_ORIGINS.",
  NOT_FOUND: "هذا الملف لم يعد موجوداً. حدّث الصفحة.",
  INVALID_INPUT: "تحقق مما كتبته ثم حاول مرة أخرى.",
};

/** What to tell a person when a message could not be sent. */
export const messageError = (code: string): string => MESSAGE_ERROR[code] ?? "تعذر الإرسال. حاول مرة أخرى.";

export const MESSAGE_ERROR_CODES = Object.keys(MESSAGE_ERROR);

/** When a message was written, as a person says it: "قبل 5 ساعات", and the day once it is older than one. */
export function agoText(at: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `قبل ${counted(minutes, { one: "دقيقة", two: "دقيقتين", few: "دقائق", many: "دقيقة" })}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `قبل ${counted(hours, { one: "ساعة", two: "ساعتين", few: "ساعات", many: "ساعة" })}`;
  return dayShort(at);
}

/** What a message without words was: a picture or a document. */
export const MESSAGE_TYPE: Record<string, string> = { image: "صورة", document: "مستند", audio: "رسالة صوتية", video: "مقطع", sticker: "ملصق", location: "موقع", template: "قالب المتابعة" };

/** How a sent message stands, in a word. */
export const MESSAGE_STATUS: Record<string, string> = {
  manual: "أُرسلت من الجوال",
  sent: "أُرسلت",
  delivered: "وصلت",
  read: "قُرئت",
  failed: "لم تُرسل",
  received: "وصلت منه",
};

/**
 * WhatsApp's own marks, where WhatsApp reads them: at the edge of a word, never inside one. A link
 * carries underscores of its own and stays as it is.
 */
const MARK = /(?<![\p{L}\p{N}_*/:.=-])(\*[^*\n]+\*|_[^_\n]+_)(?![\p{L}\p{N}_*])/gu;

/** A message cut into runs as WhatsApp shows it: plain, *bold* and _soft_. */
export function waRuns(text: string): { text: string; mark: "bold" | "soft" | null }[] {
  return text
    .split(MARK)
    .map((part, index) => (index % 2 === 0 ? { text: part, mark: null } : { text: part.slice(1, -1), mark: part.startsWith("*") ? ("bold" as const) : ("soft" as const) }))
    .filter((run) => run.text.length > 0);
}

/** A message in one line, for a list of conversations. */
export function excerpt(message: { type: string; body: string | null }, max = 96): string {
  if (message.type === "template") return "قالب المتابعة برابط ملفه";
  const line = waRuns(message.body ?? "")
    .map((run) => run.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return MESSAGE_TYPE[message.type] ?? "رسالة";
  return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
}

const WAITING: CountForms = { one: "محادثة واحدة تنتظر ردك", two: "محادثتان تنتظران ردك", few: "محادثات تنتظر ردك", many: "محادثة تنتظر ردك" };

/** How many conversations wait for an answer, as the head of the inbox says it. */
export const waitingText = (n: number): string => (n === 0 ? "لا أحد ينتظر رداً." : `${counted(n, WAITING)}.`);
