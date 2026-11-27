import { z } from "zod";
import { numberText } from "@/copy/format";
import { FEE_MAX, LEVERS, STRUCTURE_KEYS, type Levers } from "@/domain/deal";

/**
 * A scenario's levers, read from the address of the comparison page. What is missing, empty or out of
 * bounds is left as the deal has it: a scenario never fails, it only moves less.
 */
const typed = (decimals: number) => z.preprocess((value) => (typeof value === "string" ? numberText(value, decimals) || undefined : value), z.coerce.number().optional());
const within = (decimals: number, min: number, max: number) => typed(decimals).pipe(z.number().min(min).max(max).optional()).catch(undefined);

const schema = z.object({
  structure: z.enum(STRUCTURE_KEYS as [string, ...string[]]).optional().catch(undefined),
  settlePct: within(1, 0, FEE_MAX),
  financePct: within(1, 0, FEE_MAX),
  financeBase: z.enum(["total", "personal", "mortgage", "net"]).optional().catch(undefined),
  discountPct: within(0, 0, 95),
  bankMortgage: within(0, 1, 50_000_000),
  bankPersonal: within(0, 1, 10_000_000),
  propertyValue: within(0, 1, 500_000_000),
});

export function parseLevers(search: Record<string, string | string[] | undefined>): Levers {
  const flat = Object.fromEntries(LEVERS.map((lever) => [lever, Array.isArray(search[lever]) ? search[lever][0] : search[lever]]));
  const parsed = schema.parse(flat);
  return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined)) as Levers;
}

/** The address of a scenario: only the levers given, in their order. */
export function leversQuery(levers: Levers): string {
  const params = new URLSearchParams();
  for (const lever of LEVERS) if (levers[lever] != null) params.set(lever, String(levers[lever]));
  const text = params.toString();
  return text ? `?${text}` : "";
}
