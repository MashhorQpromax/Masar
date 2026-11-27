/**
 * The wording of funding routes: which lender would fund a deal, what it asks of the client and why it
 * would refuse. The engine returns codes and numbers; this file turns them into Arabic.
 */
import type { Basis, CheckStatus, Eligibility, Finding, SourceStrength, Term } from "@/domain/eligibility";
import type { FundingRoute, RouteCheck, RouteFinding, RouteNote } from "@/domain/funding";
import { checkText } from "./eligibility";
import { counted, months, type CountForms } from "./format";
import { TERM_NAME } from "./lenders";

export const ROUTE_STATUS: Record<CheckStatus, string> = {
  pass: "تقبل العميل",
  warn: "تقبل بشروط",
  fail: "لا تقبل الآن",
};

/** The four results of the strict reading, as the office names them. */
export const ELIGIBILITY: Record<Eligibility, string> = {
  eligible: "مؤهل مبدئياً",
  conditional: "مؤهل بشروط",
  not_eligible: "غير مؤهل",
  needs_verification: "بحاجة إلى تحقق",
};

/** What each result means, in one line under it. */
export const ELIGIBILITY_SAY: Record<Eligibility, string> = {
  eligible: "كل ما أمكن التحقق منه مستوفى بشروط مؤكدة. الموافقة النهائية للجهة.",
  conditional: "على العميل ما يكمله قبل التقديم.",
  not_eligible: "مانع مؤكد، ولا يتجاوزه أي حساب.",
  needs_verification: "لا تقييم موثوقاً قبل التحقق مما يلي.",
};

/** Who sets a condition: a rule every lender is bound by, what every lender does, or this lender's own policy. */
export const BASIS: Record<Basis, string> = {
  regulation: "شرط تنظيمي ملزم",
  market: "عُرف الجهات كلها",
  lender: "سياسة الجهة",
  client: "بيان عن العميل",
};

const OPEN_TERMS: CountForms = { one: "شرط واحد لم يؤكَّد", two: "شرطان لم يؤكَّدا", few: "شروط لم تؤكَّد", many: "شرطاً لم يؤكَّد" };

const named = (terms: (Term | null)[]): string => [...new Set(terms.flatMap((term) => (term ? [TERM_NAME[term]] : [])))].join("، ");

/** A condition read strictly, with the lender it belongs to. */
interface Told<C> {
  lender: string;
  finding: Finding<C & { status: CheckStatus; code: string }>;
}

/** What the lines below are written from: the doubts, and whether one lender stands behind them all. */
interface Doubtful<C> {
  doubts: Told<C>[];
  oneLender: boolean;
}

/**
 * What stands between an answer and a reliable one, in as few lines as it takes: each fact the file
 * lacks, then for each lender the terms nobody confirmed, the ones whose confirmation ran out, and
 * what nobody knows of it at all. `say` words one condition.
 */
export function doubtLines<C>({ doubts, oneLender }: Doubtful<C>, say: (check: Told<C>["finding"]["check"]) => string): string[] {
  // A fact about the client is the same for every lender. A question one lender asks about them is that lender's.
  const lines = doubts
    .filter((doubt) => doubt.finding.doubt === "FACT_MISSING")
    .map((doubt) => (doubt.finding.basis === "lender" && !oneLender ? `${doubt.lender}: ${say(doubt.finding.check)}` : say(doubt.finding.check)));
  for (const lender of [...new Set(doubts.map((doubt) => doubt.lender))]) {
    const of = doubts.filter((doubt) => doubt.lender === lender);
    const add = (text: string) => lines.push(oneLender ? text : `${lender}: ${text}`);
    const open = of.filter((doubt) => doubt.finding.doubt === "TERM_UNCONFIRMED");
    const expired = of.filter((doubt) => doubt.finding.doubt === "TERM_EXPIRED");
    if (open.length) add(`لم يؤكَّد: ${named(open.map((doubt) => doubt.finding.term))}.`);
    if (expired.length) add(`انتهى تأكيده: ${named(expired.map((doubt) => doubt.finding.term))}.`);
    for (const doubt of of) if (doubt.finding.doubt === "TERM_NOT_KNOWN") add(say(doubt.finding.check));
  }
  return lines;
}

/** The same, counted: for a row that has room for one line. */
export function doubtCount<C>({ doubts }: Pick<Doubtful<C>, "doubts">, say: (check: Told<C>["finding"]["check"]) => string): string[] {
  const facts = doubts.filter((doubt) => doubt.finding.doubt === "FACT_MISSING").map((doubt) => say(doubt.finding.check));
  const terms = doubts.length - facts.length;
  return terms > 0 ? [...facts, `${counted(terms, OPEN_TERMS)}.`] : facts;
}

/** What comes before an answer that rests on a term nobody confirmed: it holds only if the record is right. */
export const asWritten = (text: string): string => `إن صحّ المسجل عندنا: ${text}`;

/** Said of an answer that can be relied on and has only an employee's word behind it. */
export const BY_WORD = "على إفادة موظف في الجهة، لا على مستند منها.";

/** One product of one lender, read strictly: what there is to say of it. */
export interface StrictRead<C> {
  doubts: Told<C>["finding"][];
  blockers: Told<C>["finding"][];
  leans: Told<C>["finding"][];
  actions: Told<C>["finding"][];
  remarks: Told<C>["finding"][];
  eligibility: Eligibility;
  strength: SourceStrength | null;
  estimated: boolean;
}

/** One lender stands behind every line, so none of them names it. */
const alone = <C,>(findings: Told<C>["finding"][]): Doubtful<C> => ({ doubts: findings.map((finding) => ({ lender: "", finding })), oneLender: true });

/** What stands between one lender and a reliable answer: the missing facts, then its open and expired terms by name. */
export function strictDoubtLines<C>(read: Pick<StrictRead<C>, "doubts">, say: (check: Told<C>["finding"]["check"]) => string): string[] {
  return doubtLines(alone(read.doubts), say);
}

/**
 * What a lender's row says under its figures: how much of it is unconfirmed, what the record leans
 * to, what the client has to do, what the lender is confirmed to take, and whether the figures are firm.
 */
export function strictLines<C>(read: Omit<StrictRead<C>, "blockers">, say: (check: Told<C>["finding"]["check"]) => string): string[] {
  const reliable = read.eligibility === "eligible" || read.eligibility === "conditional";
  return [
    ...doubtCount(alone(read.doubts), say),
    ...read.leans.map((lean) => asWritten(say(lean.check))),
    ...[...read.actions, ...read.remarks].map((finding) => say(finding.check)),
    ...(reliable && read.strength === "verbal" ? [BY_WORD] : []),
    ...(reliable && read.estimated ? ["المبلغ والهامش استرشاديان."] : []),
  ];
}

/** Why a lender does not take the client: what is certain, said as it is, and what the record only leans to, said as that. */
export function strictRefusalLines<C>(read: Pick<StrictRead<C>, "blockers" | "leans">, say: (check: Told<C>["finding"]["check"]) => string): string[] {
  return [...read.blockers.map((blocker) => say(blocker.check)), ...read.leans.filter((lean) => lean.leans === "blocked").map((lean) => asWritten(say(lean.check)))];
}

export const routeDoubtLines = (route: Pick<FundingRoute, "doubts" | "oneLender">): string[] => doubtLines(route, routeCheckText);
export const routeDoubtCount = (route: Pick<FundingRoute, "doubts">): string[] => doubtCount(route, routeCheckText);

/**
 * What the record leans to on terms nobody confirmed: as written the lender would turn the client
 * down, or ask something of them, and nobody knows that it would. The line says both.
 */
export function routeLeanLines(route: Pick<FundingRoute, "leans" | "oneLender">): string[] {
  return route.leans.map((lean) => asWritten(routeFindingText(lean, route)));
}

/** One thing a lender asks or holds against the client. The lender is the subject of the sentence. */
export function routeCheckText(check: RouteCheck): string {
  switch (check.code) {
    case "SALARY_TRANSFER":
      return check.status === "pass" ? "الراتب محوّل عليها." : "تشترط تحويل الراتب إليها.";
    case "TWO_SALARY_TRANSFERS":
      return "الجهتان تشترطان تحويل الراتب، ولا يُحوَّل إلا إلى واحدة.";
    case "RECORD_OPEN":
      return "يبقى في السجل تعثر أو قرار تنفيذ لا تسدده الصفقة.";
    case "RECORD_LATE":
      return check.status === "fail" ? "في السجل تأخر سداد حديث، وهي لا تقبله." : "في السجل تأخر سداد حديث، وتقبله بشروط.";
    case "SETTLED_ACCEPTED":
      return "تقبل العميل بعد سداد تعثره وتحديث سمة.";
    case "SETTLED_UNCONFIRMED":
      return "لم نؤكد معها متى تقبل عميلاً سدّد تعثره.";
    case "SETTLED_WAIT":
      // Asked who takes the client today, the wait refuses. On a deal's road it is time the deal waits.
      return check.status === "fail"
        ? `لا تقبل من سدّد تعثره إلا بعد مدة، والباقي منها ${months(check.params.months)}.`
        : `تقبل من سدّد تعثره بعد مدة من السداد، والباقي منها ${months(check.params.months)}. تنتظرها الصفقة ولا تُرفض بها.`;
    default:
      return checkText(check);
  }
}

/** A condition with the lender that sets it, when the route has two lenders and the reader must know which. */
export function routeNoteText(note: RouteNote, route: Pick<FundingRoute, "oneLender">): string {
  const text = routeCheckText(note.check);
  const aboutAll = note.check.code === "TWO_SALARY_TRANSFERS" || note.check.code === "RECORD_UNKNOWN" || note.check.code === "RECORD_OPEN";
  return route.oneLender || aboutAll ? text : `${note.lender}: ${text}`;
}

/**
 * A condition read strictly. A lender's own policy carries the lender's name when the route has two;
 * a rule every lender is bound by, and a fact about the client, belong to no lender.
 */
export function routeFindingText({ lender, finding }: RouteFinding, route: Pick<FundingRoute, "oneLender">): string {
  return finding.basis === "lender" ? routeNoteText({ lender, check: finding.check }, route) : routeCheckText(finding.check);
}

/** Who funds the route, in a few words. */
export function routeLenders(route: Pick<FundingRoute, "mortgage" | "personal" | "oneLender">): { main: string; also: string | null } {
  const mortgage = route.mortgage?.product.lenderName ?? null;
  const personal = route.personal?.product.lenderName ?? null;
  if (mortgage && personal && !route.oneLender) return { main: mortgage, also: `والشخصي من ${personal}` };
  return { main: mortgage ?? personal ?? "", also: null };
}

const APPLY_ERROR: Record<string, string> = {
  NOT_FOUND: "هذه الصفقة لم تعد موجودة.",
  DEAL_ENDED: "الصفقة انتهت، وأرقامها لا تُعدَّل.",
  OFFER_RECORDED: "على الصفقة عرض فعلي من الجهة، ولا يُستبدل بتقدير.",
  ROUTE_GONE: "تغيّرت شروط الجهات. حدّث الصفحة واختر من جديد.",
  ROUTE_REFUSED: "هذه الجهة لا تقبل العميل بشروطها المسجلة.",
  INVALID_INPUT: "شروط هذه الجهة خارج الحدود المقبولة في الصفقة. راجعها في قائمة الجهات.",
  FORBIDDEN: "لا تملك صلاحية هذا التعديل.",
};

/** What to tell a person when a route could not be put on the deal. */
export const routeError = (code: string): string => APPLY_ERROR[code] ?? "تعذر الحفظ. حاول مرة أخرى.";

export const ROUTE_ERROR_CODES = Object.keys(APPLY_ERROR);
