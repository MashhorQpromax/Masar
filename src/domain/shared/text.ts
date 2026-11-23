/**
 * Letters that people type one for another in Arabic names. A search for "احمد" must find "أحمد",
 * and "ساره" must find "سارة".
 */
export const FOLD_FROM = "أإآٱةىؤئ";
export const FOLD_TO = "ااااهيوي";
/** Marks that carry no letter: the short vowels and the stretching line. */
export const FOLD_DROP = "ًٌٍَُِّْـ";

/** A text as a search compares it: lower case, the look-alike letters as one, no vowel marks, single spaces. */
export function foldText(text: string): string {
  let out = "";
  for (const ch of text.toLowerCase()) {
    if (FOLD_DROP.includes(ch)) continue;
    const at = FOLD_FROM.indexOf(ch);
    out += at >= 0 ? FOLD_TO[at] : ch;
  }
  return out.replace(/\s+/g, " ").trim();
}
