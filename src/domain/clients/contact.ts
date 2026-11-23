import { digitsOf } from "../shared/phone";

export const NATIONALITIES = ["saudi", "non_saudi"] as const;
export type ClientNationality = (typeof NATIONALITIES)[number];

/**
 * Why an identity number is refused:
 * - `ID_FORMAT`: it is not ten digits that begin with 1 or 2.
 * - `ID_KIND`: it is the other kind of number, an iqama for a citizen or the reverse.
 * - `ID_CHECK`: a digit was mistyped. The last digit does not agree with the nine before it.
 */
export type IdProblem = "ID_FORMAT" | "ID_KIND" | "ID_CHECK";

/** The ten digits of an identity number as they are stored, whatever keyboard they were typed on. */
export const idDigits = (text: string): string => digitsOf(text);

/**
 * Checks a national identity number or an iqama number. Both are ten digits: the first says which
 * (1 for a citizen, 2 for a resident), and the last is a check digit worked out from the other nine
 * the way card numbers are (Luhn), so a mistyped digit is caught before it reaches a lender.
 */
export function idProblem(id: string, nationality: ClientNationality): IdProblem | null {
  if (!/^[12]\d{9}$/.test(id)) return "ID_FORMAT";
  if ((id[0] === "1") !== (nationality === "saudi")) return "ID_KIND";
  let sum = 0;
  for (let index = 0; index < 10; index++) {
    const digit = Number(id[index]);
    if (index % 2 === 0) sum += digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    else sum += digit;
  }
  return sum % 10 === 0 ? null : "ID_CHECK";
}

/** An email address as far as its shape goes: something, an at sign, a domain with a dot. */
export const isEmail = (text: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text) && text.length <= 160;
