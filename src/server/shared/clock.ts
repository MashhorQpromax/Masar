import "server-only";

const riyadh = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" });

/** The calendar day in Riyadh as yyyy/mm/dd, the form SIMAH prints its dates in. */
export function riyadhDay(now: Date): string {
  return riyadh.format(now).replaceAll("-", "/");
}
