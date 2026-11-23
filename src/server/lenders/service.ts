import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { ZodType } from "zod";
import { bankCodeIn, FINANCE_TYPES, SECTORS, type FinanceType, type Nationality, type Product, type Sector } from "@/domain/eligibility";
import { foldText } from "@/domain/shared/text";
import type { Db, Tx } from "../db/client";
import { lenderRules, lenders, products } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { BASE_LENDERS, BASE_PRODUCTS, BASE_RULES } from "./base";
import { newLenderSchema, newProductSchema, productScopeSchema, productTermsSchema, type ProductScope, type ProductTerms } from "./input";

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

/** A product as the catalogue page lists it. One that was stopped is kept, and no client is sent to it. */
export interface CatalogueProduct extends Product {
  active: boolean;
}

/** A lender with its products, for the page where their terms are kept. */
export interface CatalogueLender {
  id: number;
  name: string;
  type: LenderRow["type"];
  products: CatalogueProduct[];
}

/**
 * The whole catalogue, lender by lender. As clients are matched against it, it holds what is in use:
 * products that run, and the lenders that have one. With `stopped` it also holds what a person who
 * keeps the catalogue must be able to reach: a stopped product, and a lender that has no product yet.
 */
export async function listCatalogue(db: Tx, args: { stopped?: boolean } = {}): Promise<CatalogueLender[]> {
  const rows = await db
    .select({ product: products, lender: lenders })
    .from(lenders)
    .leftJoin(products, eq(products.lenderId, lenders.id))
    .where(eq(lenders.active, true))
    .orderBy(asc(lenders.id), asc(products.id));
  const byLender = new Map<number, CatalogueLender>();
  for (const { product, lender } of rows) {
    const entry = byLender.get(lender.id) ?? { id: lender.id, name: lender.name, type: lender.type, products: [] };
    byLender.set(lender.id, entry);
    if (!product || !knownKind({ product }) || (!product.active && !args.stopped)) continue;
    entry.products.push({ ...productOf(product, lender), active: product.active });
  }
  const all = [...byLender.values()];
  return args.stopped ? all : all.filter((lender) => lender.products.length > 0);
}

/** What a person wrote, checked against what it should be. A refusal names the values that are not. */
function checked<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * Adds a lender to the catalogue. It starts with no product, so no client is sent to it yet. A bank
 * takes the code of the salary bank its name speaks of, or one of its own, so a client whose salary
 * is paid into it can be said to bank there.
 */
export async function addLender(db: Db, args: { input: unknown; actor: Actor }): Promise<{ lenderId: number }> {
  const input = checked(newLenderSchema, args.input);
  return db.transaction(async (tx) => {
    const all = await tx.select({ id: lenders.id, name: lenders.name, bankCode: lenders.bankCode }).from(lenders);
    const twin = all.find((lender) => foldText(lender.name) === foldText(input.name));
    if (twin) throw new DomainError("LENDER_KNOWN", `lender ${twin.id}`, { name: twin.name });
    const named = input.type === "bank" ? bankCodeIn(input.name) : null;
    const free = named && !all.some((lender) => lender.bankCode === named) ? named : null;
    const [created] = await tx.insert(lenders).values({ name: input.name, type: input.type, bankCode: free }).returning({ id: lenders.id });
    if (input.type === "bank" && !free) await tx.update(lenders).set({ bankCode: `bank_${created!.id}` }).where(eq(lenders.id, created!.id));
    await audit(tx, args.actor, "lender.add", "lender", created!.id, { name: input.name, type: input.type });
    return { lenderId: created!.id };
  });
}

/** Adds a product to a lender. From then on every client is matched against it. */
export async function addProduct(db: Db, args: { lenderId: number; input: unknown; actor: Actor; now?: Date }): Promise<{ productId: number }> {
  const input = checked(newProductSchema, args.input);
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const [lender] = await tx.select().from(lenders).where(and(eq(lenders.id, args.lenderId), eq(lenders.active, true)));
    if (!lender) throw new DomainError("NOT_FOUND", `lender ${args.lenderId}`);
    const { verified, ...terms } = input.terms;
    const [created] = await tx
      .insert(products)
      .values({
        lenderId: lender.id,
        financeType: input.financeType,
        ...input.scope,
        ...terms,
        // Only a mortgage has a share of the property's value.
        maxLtv: input.financeType === "mortgage" ? terms.maxLtv : null,
        verifiedAt: verified ? now : null,
      })
      .returning({ id: products.id });
    await audit(tx, args.actor, "lender.product_add", "product", created!.id, { lender: lender.name, financeType: input.financeType, verified });
    return { productId: created!.id };
  });
}

/**
 * Stops a product, or puts it back. A stopped product stays in the catalogue with its terms and with
 * everything the office learned about its lender; no client is matched against it until it is back.
 */
export async function setProductActive(db: Db, args: { productId: number; active: boolean; actor: Actor }): Promise<void> {
  await db.transaction(async (tx) => {
    const [found] = await tx.select({ product: products, lender: lenders }).from(products).innerJoin(lenders, eq(lenders.id, products.lenderId)).where(eq(products.id, args.productId));
    if (!found) throw new DomainError("NOT_FOUND", `product ${args.productId}`);
    if (found.product.active === args.active) return;
    await tx.update(products).set({ active: args.active }).where(eq(products.id, found.product.id));
    await audit(tx, args.actor, "lender.product_switch", "product", found.product.id, { active: args.active, lender: found.lender.name });
  });
}

/**
 * Corrects a product: its terms and, when given, what it is called and who it is given to. Terms
 * marked as confirmed carry the day they were confirmed, and any change to a confirmed product
 * confirms it again as of now.
 */
export async function updateProductTerms(db: Db, args: { productId: number; terms: unknown; scope?: unknown; actor: Actor; now?: Date }): Promise<void> {
  const terms: ProductTerms = checked(productTermsSchema, args.terms);
  const scope: ProductScope | null = args.scope === undefined ? null : checked(productScopeSchema, args.scope);
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(products).where(eq(products.id, args.productId));
    if (!before) throw new DomainError("NOT_FOUND", `product ${args.productId}`);
    const { verified, ...values } = terms;
    // Only a mortgage has a share of the property's value.
    if (before.financeType !== "mortgage") values.maxLtv = before.maxLtv;
    const changed: string[] = (Object.keys(values) as (keyof typeof values)[]).filter((key) => before[key] !== values[key]);
    if (scope) {
      if (before.name !== scope.name) changed.push("name");
      if (!sameList(before.sectors, scope.sectors)) changed.push("sectors");
      if (!sameList(before.nationalities, scope.nationalities)) changed.push("nationalities");
      if (before.minAge !== scope.minAge) changed.push("minAge");
    }
    const wasVerified = before.verifiedAt != null;
    if (!changed.length && wasVerified === verified) return;
    const verifiedAt = verified ? (wasVerified && !changed.length ? before.verifiedAt : now) : null;
    await tx
      .update(products)
      .set({ ...values, ...(scope ?? {}), verifiedAt })
      .where(eq(products.id, before.id));
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
