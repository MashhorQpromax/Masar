import { z } from "zod";
import { NATIONALITIES } from "@/domain/clients";
import { SECTORS } from "@/domain/deal";

const amount = z.number().min(0).max(10_000_000);

/** The facts about a person that a deal is computed from. */
export const borrowerInputSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    birthYear: z.number().int().min(1930).nullable(),
    sector: z.enum(SECTORS),
    basicSalary: amount.nullable(),
    totalSalary: amount.nullable(),
    serviceMonths: z.number().int().min(0).max(720).nullable(),
  })
  .superRefine((input, ctx) => {
    if (input.birthYear != null && input.birthYear > new Date().getFullYear() - 18) {
      ctx.addIssue({ code: "custom", path: ["birthYear"], message: "must be an adult" });
    }
    if (input.basicSalary != null && input.totalSalary != null && input.basicSalary > input.totalSalary) {
      ctx.addIssue({ code: "custom", path: ["basicSalary"], message: "basic salary above total salary" });
    }
  });

export type BorrowerInput = z.infer<typeof borrowerInputSchema>;

/** A line a person may leave empty. Empty reads as "not known". */
const optional = (max: number) =>
  z
    .string()
    .max(max * 4)
    .nullish()
    .transform((value) => value?.replace(/\s+/g, " ").trim().slice(0, max) || null);

/**
 * How to reach a client and who they are on paper. Kept as typed here; the service checks the phone,
 * the identity number and the email, and says which one is wrong.
 */
export const contactInputSchema = z.object({
  phone: optional(30),
  nationality: z.enum(NATIONALITIES),
  nationalId: optional(30),
  employer: optional(120),
  city: optional(60),
  email: optional(160),
});

export type ContactInput = z.infer<typeof contactInputSchema>;
