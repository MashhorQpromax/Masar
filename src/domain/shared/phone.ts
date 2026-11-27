const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Keeps the digits of a text, reading Arabic and Persian numerals as the ones they stand for. */
export function digitsOf(text: string): string {
  return text
    .replace(/[٠-٩]/g, (ch) => String(ARABIC_DIGITS.indexOf(ch)))
    .replace(/[۰-۹]/g, (ch) => String(PERSIAN_DIGITS.indexOf(ch)))
    .replace(/\D/g, "");
}

/**
 * A mobile number in international form without the plus sign, as WhatsApp takes it: 9665xxxxxxxx.
 * Saudi numbers may be written 05xxxxxxxx or 5xxxxxxxx. Null when the text is not a phone number.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = digitsOf(phone);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("05") && digits.length === 10) digits = `966${digits.slice(1)}`;
  else if (digits.startsWith("5") && digits.length === 9) digits = `966${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}
