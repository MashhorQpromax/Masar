/**
 * Item labels follow the pattern "title — party", for example "قرار تنفيذ 4471 — شركة التمويل (2024/03/11)".
 * The long dash is a separator that the code splits on, so it must never be replaced in stored labels.
 */
export const LABEL_SEPARATOR = "—";

const clean = (text: string): string =>
  text
    .replace(/\(\d{4}\/\d{2}\/\d{2}\)/g, "")
    .replace(/\b\d{6,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Title and party of a label, with dates and long reference numbers removed. */
export function splitLabel(label: string): { title: string; party: string | null } {
  const [title = "", party] = label.split(LABEL_SEPARATOR).map(clean);
  return { title, party: party || null };
}

/** Label without dates and long reference numbers, safe to show in a compact summary. */
export function shortLabel(label: string): string {
  const { title, party } = splitLabel(label);
  return party ? `${title} ${LABEL_SEPARATOR} ${party}` : title;
}
