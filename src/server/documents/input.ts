import { z } from "zod";
import { gregorianBirthYear } from "@/domain/shared/calendar";

/** The name of a paper a person adds to a file, such as something one lender alone asks for. */
export const paperLabelSchema = z.string().trim().min(2).max(80);

const figure = z.number().refine(Number.isFinite);

/**
 * The figures a person wrote down from a paper. Each is left out when the paper does not give it or
 * nobody wrote it. A year of birth typed from the Hijri date is kept as the Gregorian year it falls in.
 */
export const statedSchema = z.strictObject({
  totalSalary: figure.optional(),
  basicSalary: figure.optional(),
  birthYear: z.number().int().transform(gregorianBirthYear).optional(),
});

/** What a person who may verify says about a paper: it is good, with what it states, or it goes back with the reason. */
export const reviewSchema = z.discriminatedUnion("verdict", [
  z.object({ verdict: z.literal("verified"), stated: statedSchema.optional() }),
  z.object({ verdict: z.literal("rejected"), note: z.string().trim().min(2).max(200) }),
]);

export type PaperReview = z.infer<typeof reviewSchema>;
