/** Whole-riyal rounding. Every named money quantity in the engines is rounded with this. */
export const round0 = (n: number): number => Math.round(n);

/** Round to one decimal place (percentages shown to the user). */
export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Round to two decimal places (ratios such as collateral cover). */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const sum = <T>(items: readonly T[], pick: (item: T) => number): number =>
  items.reduce((total, item) => total + pick(item), 0);
