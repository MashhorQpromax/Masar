import "server-only";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { FINANCE_TYPES, SECTORS, type FinanceType, type Nationality, type Product, type Sector } from "@/domain/eligibility";
import type { Db, Tx } from "../db/client";
import { lenderRules, lenders, products } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { BASE_LENDERS, BASE_PRODUCTS, BASE_RULES } from "./base";
import { productTermsSchema, type ProductTerms } from "./input";

const known = <T extends string>(values: readonly T[], list: readonly string[]): T[] => list.filter((v): v is T => (values as readonly string[]).includes(v));

type ProductRow = typeof products.$inferSelect;
type LenderRow = typeof lenders.$inferSelect;

function productOf(product: ProductRow, lender: LenderRow): Product {
  return {
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
  };
}

const knownKind = ({ product }: { product: ProductRow }) => (FINANCE_TYPES as readonly string[]).includes(product.financeType);

/** Every product a client can be sent to: active products of active lenders, as the engines read them. */
export async function listProducts(db: Tx): Promise<Product[]> {
  const rows = await db
    .select({ product: products, lender: lenders })
    .from(products)
    .innerJoin(lenders, eq(lenders.id, products.lenderId))
    .where(and(eq(products.active, true), eq(lenders.active, true)))
    .orderBy(lenders.id, products.id);
  return rows.filter(knownKind).map(({ product, lender }) => productOf(product, lender));
}

/** A lender with its products, for the page where their terms are kept. */
export interface CatalogueLender {
  id: number;
  name: string;
  type: LenderRow["type"];
  products: Product[];
}

/** The whole catalogue, lender by lender. */
export async function listCatalogue(db: Tx): Promise<CatalogueLender[]> {
  const rows = await db
    .select({ product: products, lender: lenders })
    .from(products)
    .innerJoin(lenders, eq(lenders.id, products.lenderId))
    .where(and(eq(products.active, true), eq(lenders.active, true)))
    .orderBy(lenders.id, products.id);
  const byLender = new Map<number, CatalogueLender>();
  for (const { product, lender } of rows.filter(knownKind)) {
    const entry = byLender.get(lender.id) ?? { id: lender.id, name: lender.name, type: lender.type, products: [] };
    entry.products.push(productOf(product, lender));
    byLender.set(lender.id, entry);
  }
  return [...byLender.values()];
}

/**
 * Corrects the terms of a product. Terms marked as confirmed carry the day they were confirmed, and
 * changing a confirmed term confirms it again as of now.
 */
export async function updateProductTerms(db: Db, args: { productId: number; terms: unknown; actor: Actor; now?: Date }): Promise<void> {
  let terms: ProductTerms;
  try {
    terms = productTermsSchema.parse(args.terms);
  } catch (error) {
    if (error instanceof ZodError) throw new DomainError("INVALID_INPUT", error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    throw error;
  }
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(products).where(eq(products.id, args.productId));
    if (!before) throw new DomainError("NOT_FOUND", `product ${args.productId}`);
    const { verified, ...values } = terms;
    // Only a mortgage has a share of the property's value.
    if (before.financeType !== "mortgage") values.maxLtv = before.maxLtv;
    const changed = (Object.keys(values) as (keyof typeof values)[]).filter((key) => before[key] !== values[key]);
    const wasVerified = before.verifiedAt != null;
    if (!changed.length && wasVerified === verified) return;
    const verifiedAt = verified ? (wasVerified && !changed.length ? before.verifiedAt : now) : null;
    await tx.update(products).set({ ...values, verifiedAt }).where(eq(products.id, before.id));
    await audit(tx, args.actor, "lender.product_update", "product", before.id, { changed, verified });
  });
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
