/**
 * The words of the client's net: each line, where its figure comes from, and what in the sum is
 * confirmed and what is an estimate.
 */
import type { Certainty, ClientNet, NetLine, NetPart } from "@/domain/deal";
import { ltr, percent } from "./format";

export const CERTAINTY: Record<Certainty, string> = { confirmed: "مؤكد", estimated: "تقديري" };

export const NET_PART: Record<NetPart, string> = {
  mortgage: "التمويل العقاري",
  personal: "التمويل الشخصي",
  obligations: "الالتزامات",
  costs: "الرسوم والتكاليف",
  fee: "أتعابنا",
};

/** What the client keeps, as the last line of the sum. */
export const NET_TOTAL = "يبقى للعميل";
export const NET_DEFICIT = "العجز";

const joined = (parts: readonly string[]): string => parts.join(" و");

/** Where one line's figure comes from, in a few words. */
export function lineSource(line: NetLine): string {
  switch (line.part) {
    case "mortgage":
    case "personal":
      if (line.certainty === "confirmed") return "من عرض الجهة المكتوب";
      return line.held ? "سقف منتج الجهة، بلا عرض مكتوب" : "محسوب من الراتب والشروط، بلا عرض مكتوب";
    case "obligations": {
      const { all, confirmed } = line.count ?? { all: 0, confirmed: 0 };
      if (confirmed === all) return all === 1 ? "بخطاب من الدائن" : "كلها بخطابات من الدائنين";
      if (confirmed === 0) return all === 1 ? "بلا خطاب من الدائن" : "بلا خطابات من الدائنين";
      return `${ltr(confirmed)} من ${ltr(all)} بخطاب من الدائن`;
    }
    case "costs":
      return "محسوبة من التقييم المتوقع والشروط العامة";
    case "fee":
      return line.certainty === "confirmed" ? "على أرقام مؤكدة" : "على أرقام فيها تقدير";
  }
}

/**
 * Which lines of the sum are confirmed and which are estimates, so the total never goes without it. A
 * line only part of which a paper confirms is an estimate, and says so.
 */
export function netWhy(net: Pick<ClientNet, "certainty" | "confirmed" | "estimated" | "partly">): string {
  if (net.certainty === "confirmed") return "كل ما فيه من عرض مكتوب وخطابات الدائنين.";
  if (net.confirmed.length === 0 && net.partly.length === 0) return "كل ما فيه محسوب من الشروط العامة، ولا شيء منه بورقة مكتوبة.";
  const estimated = joined(net.estimated.map((part) => (net.partly.includes(part) ? `${NET_PART[part]} (مؤكد بعضها)` : NET_PART[part])));
  return net.confirmed.length === 0 ? `التقديري فيه: ${estimated}.` : `المؤكد فيه: ${joined(net.confirmed.map((part) => NET_PART[part]))}. والتقديري: ${estimated}.`;
}

/** The monthly deduction after the financing, beside its cap. Null when the salary is not known. */
export function deductionText(deduction: ClientNet["deduction"]): string | null {
  if (deduction.after == null) return null;
  return `الاستقطاع بعد التمويل ${percent(deduction.after)} من الراتب، والسقف ${percent(deduction.cap)}`;
}
