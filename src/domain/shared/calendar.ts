/**
 * The Gregorian year that a Hijri year mostly falls in. Good to within one year, which is all a
 * birth year needs: a Hijri year is about 354 days and straddles two Gregorian years.
 */
export function hijriToGregorianYear(hijri: number): number {
  return Math.round(hijri * 0.970224 + 621.5774);
}

/** A birth year as typed, in either calendar, as a Gregorian year. Years from 1300 to 1500 are read as Hijri. */
export function gregorianBirthYear(typed: number): number {
  return typed >= 1300 && typed <= 1500 ? hijriToGregorianYear(typed) : typed;
}
