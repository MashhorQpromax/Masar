import { z } from "zod";

/** The name of a paper a person adds to a file, such as something one lender alone asks for. */
export const paperLabelSchema = z.string().trim().min(2).max(80);

/** What a person who may verify says about a paper: it is good, or it goes back with the reason. */
export const reviewSchema = z.discriminatedUnion("verdict", [
  z.object({ verdict: z.literal("verified") }),
  z.object({ verdict: z.literal("rejected"), note: z.string().trim().min(2).max(200) }),
]);

export type PaperReview = z.infer<typeof reviewSchema>;
