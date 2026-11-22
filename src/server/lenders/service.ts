import "server-only";
import { and, eq } from "drizzle-orm";
import { FINANCE_TYPES, SECTORS, type FinanceType, type Nationality, type Product, type Sector } from "@/domain/eligibility";
import type { Db, Tx } from "../db/client";
import { lenderRules, lenders, products } from "../db/schema";
import { BASE_LENDERS, BASE_PRODUCTS, BASE_RULES } from "./base";

const known = <T extends string>(values: readonly T[], list: readonly string[]): T[] => list.filter((v): v is T => (values as readonly string[]).includes(v));

/** Every product a client can be sent to: active products of active lenders, as the engines read them. */
export async function listProducts(db: Tx): Promise<Product[]> {
  const rows = await db
    .select({ product: products, lender: lenders })
    .from(products)
    .innerJoin(lenders, eq(lenders.id, products.lenderId))
    .where(and(eq(products.active, true), eq(lenders.active, true)))
    .orderBy(lenders.id, products.id);
  return rows
    .filter(({ product }) => (FINANCE_TYPES as readonly string[]).includes(product.financeType))
    .map(({ product, lender }) => ({
      id: String(product.id),
      lenderId: String(lender.id),
      lenderName: lender.name,
      lenderType: lender.type,
      bankCode: lender.bankCode,
      financeType: product.financeType as FinanceType,
      name: product.name,
      minSalary: product.minSalary,
      minAge: product.minAge,
      maxAgeAtMaturity: product.maxAgeAtMaturity,
      minServiceMonths: product.minServiceMonths,
      sectors: known<Sector>(SECTORS, product.sectors),
      nationalities: known<Nationality>(["saudi", "non_saudi"], product.nationalities),
      maxTenor: product.maxTenor,
      maxAmount: product.maxAmount,
      rate: product.rate,
      rateType: product.rateType === "reducing" ? "reducing" : "flat",
      requiresSalaryTransfer: product.requiresSalaryTransfer,
      acceptsLateSimah: product.acceptsLateSimah,
      maxLtv: product.maxLtv,
      notes: product.notes,
      settledDefaultWaitMonths: product.settledDefaultWaitMonths,
      verified: product.verifiedAt != null,
    }));
}

/** Fills an empty catalogue with the base lenders, products and market rules. Does nothing when lenders exist. */
export async function seedCatalogue(db: Db): Promise<{ lenders: number; products: number }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: lenders.id }).from(lenders).limit(1);
    if (existing) return { lenders: 0, products: 0 };
    const created = await tx.insert(lenders).values(BASE_LENDERS).returning({ id: lenders.id, name: lenders.name });
    const idOf = new Map(created.map((l) => [l.name, l.id]));
    await tx.insert(products).values(
      BASE_PRODUCTS.map((p) => ({
        lenderId: idOf.get(p.lender)!,
        financeType: p.financeType,
        name: p.name,
        minSalary: p.minSalary,
        minAge: p.minAge ?? 21,
        maxAgeAtMaturity: p.maxAgeAtMaturity,
        minServiceMonths: p.minServiceMonths,
        sectors: p.sectors,
        nationalities: p.nationalities ?? ["saudi"],
        maxTenor: p.maxTenor,
        maxAmount: p.maxAmount,
        rate: p.rate,
        rateType: p.rateType ?? "flat",
        requiresSalaryTransfer: p.requiresSalaryTransfer ?? true,
        acceptsLateSimah: p.acceptsLateSimah ?? false,
        maxLtv: p.maxLtv ?? null,
      })),
    );
    await tx.insert(lenderRules).values(
      BASE_RULES.map((r) => ({ lenderId: r.lender ? idOf.get(r.lender)! : null, financeType: r.financeType, kind: r.kind, title: r.title, body: r.body })),
    );
    return { lenders: BASE_LENDERS.length, products: BASE_PRODUCTS.length };
  });
}
