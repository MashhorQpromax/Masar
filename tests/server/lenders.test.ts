import { asc, desc, eq, gt } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bankCodeIn, openTerms, type Product } from "@/domain/eligibility";
import type { Connection } from "@/server/db/client";
import { auditLog, lenderRules, lenders, products, termSources } from "@/server/db/schema";
import { roadView } from "@/server/deals/views";
import { seedDemo } from "@/server/demo/seed";
import { getFunding } from "@/server/funding/service";
import { addLender, addProduct, confirmTerms, listCatalogue, listProducts, setProductActive, updateProductTerms, withdrawTerms } from "@/server/lenders/service";
import { testDb } from "../helpers/db";

let c: Connection;
const now = new Date("2026-11-22T09:00:00Z");
const later = new Date("2026-11-23T09:00:00Z");
const actor = { userId: null, ip: "10.0.0.7" };
const deal: Record<string, number> = {};

beforeAll(async () => {
  c = await testDb();
  await seedDemo(c.db, now);
  for (const found of (await roadView(c.db, now)).deals) deal[found.clientName] = found.dealId;
});
afterAll(async () => {
  await c.close();
});

const code = async (run: () => Promise<unknown>) => run().then(() => "ok", (error) => error.code ?? String(error));
const params = async (run: () => Promise<unknown>) => run().then(() => null, (error) => error.params);
const lastId = async () => (await c.db.select({ id: auditLog.id }).from(auditLog).orderBy(desc(auditLog.id)).limit(1))[0]?.id ?? 0;
const eventsAfter = async (id: number) => c.db.select({ action: auditLog.action, entity: auditLog.entity, entityId: auditLog.entityId, details: auditLog.details }).from(auditLog).where(gt(auditLog.id, id)).orderBy(asc(auditLog.id));
const lenderRow = async (id: number) => (await c.db.select().from(lenders).where(eq(lenders.id, id)))[0]!;
const productRow = async (id: number) => (await c.db.select().from(products).where(eq(products.id, id)))[0]!;
const counts = async () => ({ lenders: (await c.db.select({ id: lenders.id }).from(lenders)).length, products: (await c.db.select({ id: products.id }).from(products)).length });

const terms = (over: Record<string, unknown> = {}) => ({
  rate: 4.1,
  rateType: "flat",
  maxAmount: 1_800_000,
  maxTenor: 60,
  maxAgeAtMaturity: 65,
  minSalary: 5000,
  minServiceMonths: 6,
  maxLtv: null,
  requiresSalaryTransfer: true,
  acceptsLateSimah: false,
  settledDefaultWaitMonths: null,
  ...over,
});
const scope = (over: Record<string, unknown> = {}) => ({ name: "التمويل الشخصي", sectors: ["gov", "semi_gov", "military"], nationalities: ["saudi"], minAge: 21, ...over });
const product = (over: Record<string, unknown> = {}) => ({ financeType: "personal", scope: scope(), terms: terms(), ...over });
const termsOf = (p: Product) => ({
  rate: p.rate,
  rateType: p.rateType,
  maxAmount: p.maxAmount,
  maxTenor: p.maxTenor,
  maxAgeAtMaturity: p.maxAgeAtMaturity,
  minSalary: p.minSalary,
  minServiceMonths: p.minServiceMonths,
  maxLtv: p.maxLtv ?? null,
  requiresSalaryTransfer: p.requiresSalaryTransfer,
  acceptsLateSimah: p.acceptsLateSimah,
  settledDefaultWaitMonths: p.settledDefaultWaitMonths ?? null,
});

const added: Record<string, number> = {};

describe("the catalogue as its page lists it", () => {
  it("lists every lender in use with its running products", async () => {
    const catalogue = await listCatalogue(c.db);
    expect(catalogue).toHaveLength(10);
    expect(catalogue.flatMap((lender) => lender.products)).toHaveLength(14);
    expect(catalogue.flatMap((lender) => lender.products).every((p) => p.active)).toBe(true);
    expect(catalogue[0]).toMatchObject({ name: "مصرف الراجحي", type: "bank" });
    expect(catalogue[0]!.products.map((p) => p.financeType)).toEqual(["personal", "mortgage", "auto"]);
    // Nothing is stopped and every lender has a product, so its keeper sees the same.
    expect(await listCatalogue(c.db, { stopped: true })).toEqual(catalogue);
  });
});

describe("the salary bank a lender's name speaks of", () => {
  it("is found in the full name, and is none for a name that speaks of no bank we name", () => {
    expect(bankCodeIn("مصرف الراجحي")).toBe("rajhi");
    expect(bankCodeIn("البنك العربي الوطني")).toBe("anb");
    expect(bankCodeIn("البنك السعودي الأول")).toBe("sab");
    expect(bankCodeIn("البنك السعودي الفرنسي")).toBe("bsf");
    expect(bankCodeIn("بنك الجزيرة")).toBe("aljazira");
    expect(bankCodeIn("البنك السعودي للاستثمار")).toBe("saib");
    expect(bankCodeIn("بنك الخليج الدولي")).toBeNull();
    expect(bankCodeIn("")).toBeNull();
  });
});

describe("adding a lender", () => {
  it("adds a bank under the code its name speaks of, with no product yet", async () => {
    const before = await lastId();
    const { lenderId } = await addLender(c.db, { input: { name: "  البنك   العربي الوطني ", type: "bank" }, actor });
    added["anb"] = lenderId;
    expect(await lenderRow(lenderId)).toMatchObject({ name: "البنك العربي الوطني", type: "bank", bankCode: "anb", active: true });
    expect(await eventsAfter(before)).toEqual([{ action: "lender.add", entity: "lender", entityId: lenderId, details: { name: "البنك العربي الوطني", type: "bank" } }]);
    // No client is sent to a lender that has no product, so only its keeper sees it.
    expect((await listCatalogue(c.db)).map((lender) => lender.name)).not.toContain("البنك العربي الوطني");
    const kept = (await listCatalogue(c.db, { stopped: true })).at(-1)!;
    expect(kept).toEqual({ id: lenderId, name: "البنك العربي الوطني", type: "bank", products: [] });
    expect(await listProducts(c.db)).toHaveLength(14);
  });

  it("gives a bank a code of its own when its name speaks of none, or of one that is taken", async () => {
    const gulf = await addLender(c.db, { input: { name: "بنك الخليج الدولي", type: "bank" }, actor });
    expect((await lenderRow(gulf.lenderId)).bankCode).toBe(`bank_${gulf.lenderId}`);
    // "الأهلي" is the national bank's, and that code is in use.
    const other = await addLender(c.db, { input: { name: "البنك الأهلي المتحد", type: "bank" }, actor });
    expect((await lenderRow(other.lenderId)).bankCode).toBe(`bank_${other.lenderId}`);
    const codes = (await c.db.select({ code: lenders.bankCode }).from(lenders)).map((row) => row.code).filter(Boolean);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gives a finance company no salary bank, whatever its name says", async () => {
    const { lenderId } = await addLender(c.db, { input: { name: "الرياض للتمويل", type: "finance_company" }, actor });
    added["finance"] = lenderId;
    expect(await lenderRow(lenderId)).toMatchObject({ type: "finance_company", bankCode: null });
  });

  it("refuses a lender the catalogue already holds, however the name is written", async () => {
    const count = await counts();
    const before = await lastId();
    expect(await code(() => addLender(c.db, { input: { name: "مصرف الراجحي", type: "bank" }, actor }))).toBe("LENDER_KNOWN");
    expect(await code(() => addLender(c.db, { input: { name: " مصرف  الراجحى ", type: "finance_company" }, actor }))).toBe("LENDER_KNOWN");
    expect(await params(() => addLender(c.db, { input: { name: "البنك الاهلي السعودي", type: "bank" }, actor }))).toEqual({ name: "البنك الأهلي السعودي" });
    expect(await counts()).toEqual(count);
    expect(await eventsAfter(before)).toEqual([]);
  });

  it("refuses what is not a lender", async () => {
    const count = await counts();
    for (const bad of [{ name: "ب", type: "bank" }, { name: "   ", type: "bank" }, { name: "جهة جديدة", type: "fund" }, { name: "م".repeat(81), type: "bank" }, { type: "bank" }, null]) {
      expect(await code(() => addLender(c.db, { input: bad, actor })), JSON.stringify(bad)).toBe("INVALID_INPUT");
    }
    expect(await counts()).toEqual(count);
  });
});

describe("adding a product", () => {
  it("adds it to its lender, and clients are matched against it from then on", async () => {
    const before = await lastId();
    const { productId } = await addProduct(c.db, { lenderId: added["anb"]!, input: product(), actor });
    added["personal"] = productId;
    expect(await productRow(productId)).toMatchObject({ lenderId: added["anb"], financeType: "personal", name: "التمويل الشخصي", rate: 4.1, maxAmount: 1_800_000, minAge: 21, sectors: ["gov", "semi_gov", "military"], nationalities: ["saudi"], verifiedAt: null, active: true });
    expect(await eventsAfter(before)).toEqual([{ action: "lender.product_add", entity: "product", entityId: productId, details: { lender: "البنك العربي الوطني", financeType: "personal" } }]);
    const all = await listProducts(c.db);
    expect(all).toHaveLength(15);
    expect(all.at(-1)).toMatchObject({ id: String(productId), lenderName: "البنك العربي الوطني", lenderType: "bank", bankCode: "anb", verified: false });
    // Its lender is in use now, so everyone sees it.
    expect((await listCatalogue(c.db)).at(-1)).toMatchObject({ name: "البنك العربي الوطني", products: [{ id: String(productId), active: true }] });
  });

  it("keeps the share of the property's value to a mortgage, and starts every term unconfirmed", async () => {
    const home = await addProduct(c.db, { lenderId: added["anb"]!, input: product({ financeType: "mortgage", scope: scope({ name: "التمويل العقاري" }), terms: terms({ rate: 4.4, rateType: "reducing", maxAmount: 6_000_000, maxTenor: 300, maxAgeAtMaturity: 70, maxLtv: 85 }) }), actor });
    added["mortgage"] = home.productId;
    expect(await productRow(home.productId)).toMatchObject({ financeType: "mortgage", maxLtv: 85 });
    const car = await addProduct(c.db, { lenderId: added["finance"]!, input: product({ financeType: "auto", scope: scope({ name: "تمويل السيارات" }), terms: terms({ maxLtv: 85, requiresSalaryTransfer: false }) }), actor });
    expect(await productRow(car.productId)).toMatchObject({ financeType: "auto", maxLtv: null, requiresSalaryTransfer: false });
    // Saying a product is confirmed is not something a person can send with its terms any more.
    const claimed = await addProduct(c.db, { lenderId: added["finance"]!, input: product({ scope: scope({ name: "تمويل مؤكد بالقول" }), terms: { ...terms(), verified: true } }), actor });
    const all = await listProducts(c.db);
    const seen = (id: number) => all.find((p) => p.id === String(id))!;
    expect(seen(claimed.productId)).toMatchObject({ verified: false });
    expect(await productRow(claimed.productId)).toMatchObject({ verifiedAt: null });
    expect(Object.keys(seen(home.productId).terms!)).toEqual(["salary", "sector", "nationality", "age", "service", "transfer", "late", "settled", "amount", "tenor", "ltv", "rate"]);
    expect(Object.keys(seen(car.productId).terms!)).not.toContain("ltv");
    for (const id of [home.productId, car.productId, claimed.productId]) expect(Object.values(seen(id).terms!).every((standing) => standing.state === "unconfirmed"), String(id)).toBe(true);
    await setProductActive(c.db, { productId: claimed.productId, active: false, actor });
  });

  it("puts the new lender on the routes of a deal, and among the banks a salary can be paid into", async () => {
    const view = (await getFunding(c.db, { dealId: deal["سالم"]!, now }))!;
    expect(view.routes).toHaveLength(5);
    const route = view.routes.find((found) => found.mortgage?.product.lenderName === "البنك العربي الوطني")!;
    expect(route.mortgage!.amount).toBeGreaterThan(0);
    // Nobody said what it does after a paid default.
    expect(route.conditions.some((note) => note.lender === "البنك العربي الوطني" && note.check.code === "SETTLED_UNCONFIRMED")).toBe(true);
    expect(view.banks).toContainEqual({ code: "anb", name: "البنك العربي الوطني" });
  });

  it("keeps who it is given to in one order, however it was sent", async () => {
    const { productId } = await addProduct(c.db, { lenderId: added["finance"]!, input: product({ scope: scope({ name: "  تمويل   نقدي ", sectors: ["self", "private", "gov"], nationalities: ["non_saudi", "saudi"] }) }), actor });
    expect(await productRow(productId)).toMatchObject({ name: "تمويل نقدي", sectors: ["gov", "private", "self"], nationalities: ["saudi", "non_saudi"] });
  });

  it("refuses a lender that is not there, and what is not a product", async () => {
    const count = await counts();
    const before = await lastId();
    expect(await code(() => addProduct(c.db, { lenderId: 999999, input: product(), actor }))).toBe("NOT_FOUND");
    const refused: [string, unknown][] = [
      ["a kind no client is sent to", product({ financeType: "card" })],
      ["a kind that does not exist", product({ financeType: "lease" })],
      ["no name", product({ scope: scope({ name: " " }) })],
      ["given to nobody", product({ scope: scope({ sectors: [] }) })],
      ["a sector twice", product({ scope: scope({ sectors: ["gov", "gov"] }) })],
      ["a sector that does not exist", product({ scope: scope({ sectors: ["gov", "royal"] }) })],
      ["no nationality", product({ scope: scope({ nationalities: [] }) })],
      ["a child", product({ scope: scope({ minAge: 12 }) })],
      ["a margin out of range", product({ terms: terms({ rate: 45 }) })],
      ["a margin left empty", product({ terms: terms({ rate: Number.NaN }) })],
      ["no terms", { financeType: "personal", scope: scope() }],
      ["nothing", null],
    ];
    for (const [what, bad] of refused) expect(await code(() => addProduct(c.db, { lenderId: added["anb"]!, input: bad, actor })), what).toBe("INVALID_INPUT");
    expect(await counts()).toEqual(count);
    expect(await eventsAfter(before)).toEqual([]);
  });
});

describe("stopping a product and putting it back", () => {
  it("takes a stopped product out of every match, and keeps it where its keeper can reach it", async () => {
    const id = added["mortgage"]!;
    const before = await lastId();
    await setProductActive(c.db, { productId: id, active: false, actor });
    expect((await productRow(id)).active).toBe(false);
    expect((await listProducts(c.db)).map((p) => p.id)).not.toContain(String(id));
    expect((await getFunding(c.db, { dealId: deal["سالم"]!, now }))!.routes).toHaveLength(4);
    const seen = (await listCatalogue(c.db)).find((lender) => lender.id === added["anb"])!;
    expect(seen.products.map((p) => p.id)).toEqual([String(added["personal"])]);
    const kept = (await listCatalogue(c.db, { stopped: true })).find((lender) => lender.id === added["anb"])!;
    expect(kept.products.map((p) => [p.id, p.active])).toEqual([
      [String(added["personal"]), true],
      [String(id), false],
    ]);
    expect(await eventsAfter(before)).toEqual([{ action: "lender.product_switch", entity: "product", entityId: id, details: { active: false, lender: "البنك العربي الوطني" } }]);
    // Its terms stay as they were.
    expect(await productRow(id)).toMatchObject({ rate: 4.4, maxLtv: 85 });
  });

  it("writes nothing when the product is already as asked", async () => {
    const before = await lastId();
    await setProductActive(c.db, { productId: added["mortgage"]!, active: false, actor });
    await setProductActive(c.db, { productId: added["personal"]!, active: true, actor });
    expect(await eventsAfter(before)).toEqual([]);
  });

  it("puts it back as it was", async () => {
    const id = added["mortgage"]!;
    const before = await lastId();
    await setProductActive(c.db, { productId: id, active: true, actor });
    expect((await listProducts(c.db)).map((p) => p.id)).toContain(String(id));
    expect((await getFunding(c.db, { dealId: deal["سالم"]!, now }))!.routes).toHaveLength(5);
    expect(await eventsAfter(before)).toEqual([{ action: "lender.product_switch", entity: "product", entityId: id, details: { active: true, lender: "البنك العربي الوطني" } }]);
    expect(await code(() => setProductActive(c.db, { productId: 999999, active: false, actor }))).toBe("NOT_FOUND");
  });

  it("hides a lender from everyone but its keeper once its last product stops, and keeps what was learned about it", async () => {
    const notes = (await c.db.select({ id: lenderRules.id }).from(lenderRules)).length;
    const emkan = (await listCatalogue(c.db)).find((lender) => lender.name === "إمكان للتمويل")!;
    expect(emkan.products).toHaveLength(1);
    await setProductActive(c.db, { productId: Number(emkan.products[0]!.id), active: false, actor });
    expect((await listCatalogue(c.db)).map((lender) => lender.name)).not.toContain("إمكان للتمويل");
    expect((await listCatalogue(c.db, { stopped: true })).find((lender) => lender.id === emkan.id)!.products).toMatchObject([{ active: false }]);
    expect((await c.db.select({ id: lenderRules.id }).from(lenderRules)).length).toBe(notes);
    await setProductActive(c.db, { productId: Number(emkan.products[0]!.id), active: true, actor });
    expect((await listCatalogue(c.db)).map((lender) => lender.name)).toContain("إمكان للتمويل");
  });
});

describe("correcting what a product is called and who it is given to", () => {
  it("keeps the correction and names what changed", async () => {
    const id = added["personal"]!;
    const found = (await listProducts(c.db)).find((p) => p.id === String(id))!;
    const before = await lastId();
    await updateProductTerms(c.db, { productId: id, terms: termsOf(found), scope: scope({ name: "تمويل الموظفين", sectors: ["private_approved", "gov", "semi_gov", "military"], nationalities: ["saudi", "non_saudi"], minAge: 23 }), actor });
    expect(await productRow(id)).toMatchObject({ name: "تمويل الموظفين", sectors: ["gov", "semi_gov", "military", "private_approved"], nationalities: ["saudi", "non_saudi"], minAge: 23, rate: 4.1, verifiedAt: null });
    expect(await eventsAfter(before)).toEqual([{ action: "lender.product_update", entity: "product", entityId: id, details: { changed: ["name", "sectors", "nationalities", "minAge"], unconfirmed: [] } }]);
    expect((await listProducts(c.db)).find((p) => p.id === String(id))).toMatchObject({ name: "تمويل الموظفين", minAge: 23, nationalities: ["saudi", "non_saudi"] });
  });

  it("writes nothing when the same is saved again, in any order", async () => {
    const id = added["personal"]!;
    const found = (await listProducts(c.db)).find((p) => p.id === String(id))!;
    const before = await lastId();
    await updateProductTerms(c.db, { productId: id, terms: termsOf(found), scope: { name: "تمويل الموظفين", sectors: ["military", "semi_gov", "gov", "private_approved"], nationalities: ["non_saudi", "saudi"], minAge: 23 }, actor });
    expect(await eventsAfter(before)).toEqual([]);
  });

  it("leaves it alone when only the terms are sent", async () => {
    const id = added["personal"]!;
    const found = (await listProducts(c.db)).find((p) => p.id === String(id))!;
    await updateProductTerms(c.db, { productId: id, terms: { ...termsOf(found), rate: 3.9 }, actor });
    expect(await productRow(id)).toMatchObject({ rate: 3.9, name: "تمويل الموظفين", minAge: 23 });
  });

  it("refuses a scope that is not one, and changes nothing", async () => {
    const id = added["personal"]!;
    const found = (await listProducts(c.db)).find((p) => p.id === String(id))!;
    const row = await productRow(id);
    const before = await lastId();
    for (const bad of [scope({ sectors: [] }), scope({ name: "ب" }), scope({ minAge: 80 }), scope({ nationalities: ["saudi", "saudi"] }), null, "x"]) {
      expect(await code(() => updateProductTerms(c.db, { productId: id, terms: { ...termsOf(found), rate: 5 }, scope: bad, actor })), JSON.stringify(bad)).toBe("INVALID_INPUT");
    }
    expect(await productRow(id)).toEqual(row);
    expect(await eventsAfter(before)).toEqual([]);
  });
});

describe("confirming a product's terms with their source", () => {
  const sourcesOf = async (id: number) =>
    c.db.select({ term: termSources.term, kind: termSources.kind, reference: termSources.reference, confirmedOn: termSources.confirmedOn }).from(termSources).where(eq(termSources.productId, id)).orderBy(asc(termSources.id));
  const seen = async (id: number, at: Date = now) => (await listProducts(c.db, { now: at })).find((p) => p.id === String(id))!;
  const paper = { kind: "lender_document", reference: "تعرفة تمويل الأفراد، نوفمبر 2026" };

  it("keeps the source beside each term it speaks for, and says until when it is good", async () => {
    const id = added["personal"]!;
    const before = await lastId();
    expect(await confirmTerms(c.db, { productId: id, input: { ...paper, terms: ["rate", "salary", "age"], confirmedOn: "2026-11-20" }, actor, now })).toEqual({ terms: ["salary", "age", "rate"], validUntil: "2027-02-20" });
    expect(await sourcesOf(id)).toEqual(["salary", "age", "rate"].map((term) => ({ term, ...paper, confirmedOn: "2026-11-20" })));
    expect(await eventsAfter(before)).toEqual([
      { action: "lender.terms_confirm", entity: "product", entityId: id, details: { lender: "البنك العربي الوطني", product: "تمويل الموظفين", terms: ["salary", "age", "rate"], ...paper, confirmedOn: "2026-11-20", validUntil: "2027-02-20" } },
    ]);
    const product = await seen(id);
    expect(product.terms!.rate).toEqual({ state: "confirmed", source: { ...paper, confirmedOn: "2026-11-20" }, strength: "written", validUntil: "2027-02-20" });
    expect(product.terms!.service).toEqual({ state: "unconfirmed" });
    // Three terms out of eleven: the product as a whole is not confirmed.
    expect(product.verified).toBe(false);
    expect(openTerms("personal", product.terms)).toEqual(["sector", "nationality", "service", "transfer", "late", "settled", "amount", "tenor"]);
  });

  it("takes today in Riyadh when no day is given, and an employee's word as the weaker source", async () => {
    const id = added["personal"]!;
    // Half past one at night in Riyadh, on the 23rd.
    const night = new Date("2026-11-22T22:30:00Z");
    expect(await confirmTerms(c.db, { productId: id, input: { kind: "lender_staff", reference: "  أحمد   العتيبي، مدير علاقات الأفراد ", terms: ["service"] }, actor, now: night })).toEqual({ terms: ["service"], validUntil: "2027-02-23" });
    expect((await seen(id, night)).terms!.service).toEqual({
      state: "confirmed",
      source: { kind: "lender_staff", reference: "أحمد العتيبي، مدير علاقات الأفراد", confirmedOn: "2026-11-23" },
      strength: "verbal",
      validUntil: "2027-02-23",
    });
  });

  it("replaces what confirmed a term when it is confirmed again", async () => {
    const id = added["personal"]!;
    await confirmTerms(c.db, { productId: id, input: { kind: "lender_website", reference: "https://example.com/personal-finance", terms: ["rate"] }, actor, now });
    const rows = await sourcesOf(id);
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.term === "rate")).toEqual([{ term: "rate", kind: "lender_website", reference: "https://example.com/personal-finance", confirmedOn: "2026-11-22" }]);
  });

  it("calls a product confirmed only when every one of its terms is", async () => {
    const id = added["personal"]!;
    // Nobody can confirm a wait that nobody wrote down.
    expect(await code(() => confirmTerms(c.db, { productId: id, input: { ...paper, terms: ["settled"] }, actor, now }))).toBe("TERM_VALUE_MISSING");
    expect(await params(() => confirmTerms(c.db, { productId: id, input: { ...paper, terms: ["settled"] }, actor, now }))).toEqual({ term: "settled" });
    expect(await updateProductTerms(c.db, { productId: id, terms: { ...termsOf(await seen(id)), settledDefaultWaitMonths: 12 }, actor })).toEqual({ unconfirmed: [] });
    await confirmTerms(c.db, { productId: id, input: { ...paper, terms: ["sector", "nationality", "transfer", "late", "settled", "amount", "tenor"] }, actor, now });
    const product = await seen(id);
    expect(openTerms("personal", product.terms)).toEqual([]);
    expect(product.verified).toBe(true);
    expect((await listCatalogue(c.db, { now })).flatMap((lender) => lender.products).filter((p) => p.verified).map((p) => p.id)).toEqual([String(id)]);
  });

  it("goes back to unconfirmed for exactly the terms whose value changes", async () => {
    const id = added["personal"]!;
    const before = await lastId();
    const changed = { terms: { ...termsOf(await seen(id)), rate: 4.3, minSalary: 6000 }, scope: scope({ name: "تمويل الموظفين المطوّر", sectors: ["gov", "semi_gov"], nationalities: ["saudi", "non_saudi"], minAge: 23 }) };
    expect(await updateProductTerms(c.db, { productId: id, ...changed, actor })).toEqual({ unconfirmed: ["salary", "sector", "rate"] });
    expect(await eventsAfter(before)).toEqual([{ action: "lender.product_update", entity: "product", entityId: id, details: { changed: ["rate", "minSalary", "name", "sectors"], unconfirmed: ["salary", "sector", "rate"] } }]);
    const product = await seen(id);
    expect(openTerms("personal", product.terms)).toEqual(["salary", "sector", "rate"]);
    expect(product.verified).toBe(false);
    // The lowest age and the age at the last installment are one term: a change to either unconfirms it.
    expect(await updateProductTerms(c.db, { productId: id, terms: changed.terms, scope: { ...changed.scope, minAge: 21 }, actor })).toEqual({ unconfirmed: ["age"] });
    // Saving the same again drops nothing.
    expect(await updateProductTerms(c.db, { productId: id, terms: changed.terms, scope: { ...changed.scope, minAge: 21 }, actor })).toEqual({ unconfirmed: [] });
    expect((await sourcesOf(id)).map((row) => row.term)).toEqual(["service", "sector", "nationality", "transfer", "late", "settled", "amount", "tenor"].filter((term) => term !== "sector"));
  });

  it("stops counting on a confirmation the day after it runs out", async () => {
    const id = added["personal"]!;
    // The tenor was confirmed on the 22nd and the service on the 23rd, each good for three months.
    const lastMinute = new Date("2027-02-22T20:59:00Z");
    const midnight = new Date("2027-02-22T21:00:00Z");
    expect((await seen(id, lastMinute)).terms!.tenor).toMatchObject({ state: "confirmed", validUntil: "2027-02-22" });
    expect((await seen(id, midnight)).terms!.tenor).toEqual({ state: "expired", source: { ...paper, confirmedOn: "2026-11-22" }, validUntil: "2027-02-22" });
    expect((await seen(id, midnight)).terms!.service).toMatchObject({ state: "confirmed", validUntil: "2027-02-23" });
    const kept = (await listCatalogue(c.db, { now: midnight })).flatMap((lender) => lender.products).find((p) => p.id === String(id))!;
    expect(openTerms("personal", kept.terms)).toEqual(["salary", "sector", "nationality", "age", "transfer", "late", "settled", "amount", "tenor", "rate"]);
  });

  it("refuses a source that confirms nothing, and writes nothing", async () => {
    const id = added["mortgage"]!;
    const before = await lastId();
    const refused: [string, unknown, string, string?][] = [
      ["a site with no link", { kind: "lender_website", reference: "موقع البنك الرسمي", terms: ["rate"] }, "SOURCE_REFUSED", "LINK_NEEDED"],
      ["a day that is not one", { ...paper, terms: ["rate"], confirmedOn: "2026-02-30" }, "SOURCE_REFUSED", "DAY_INVALID"],
      ["a day ahead", { ...paper, terms: ["rate"], confirmedOn: "2026-11-23" }, "SOURCE_REFUSED", "DAY_AHEAD"],
      ["a day too long ago to be good", { ...paper, terms: ["rate"], confirmedOn: "2026-08-21" }, "SOURCE_REFUSED", "DAY_OLD"],
      ["a reference too short to name anything", { kind: "lender_staff", reference: " أحمد ", terms: ["rate"] }, "INVALID_INPUT"],
      ["what the office saw in earlier files", { kind: "office_experience", reference: "ملفات المكتب السابقة", terms: ["rate"] }, "INVALID_INPUT"],
      ["no term", { ...paper, terms: [] }, "INVALID_INPUT"],
      ["a term twice", { ...paper, terms: ["rate", "rate"] }, "INVALID_INPUT"],
      ["a term that does not exist", { ...paper, terms: ["fees"] }, "INVALID_INPUT"],
      ["a day written another way", { ...paper, terms: ["rate"], confirmedOn: "22/11/2026" }, "INVALID_INPUT"],
      ["nothing", null, "INVALID_INPUT"],
    ];
    for (const [what, input, expected, problem] of refused) {
      const error = await confirmTerms(c.db, { productId: id, input, actor, now }).then(
        () => null,
        (thrown) => thrown,
      );
      expect(error?.code, what).toBe(expected);
      if (problem) expect(error.params, what).toEqual({ problem });
    }
    // A share of a property's value is a term of a mortgage only.
    expect(await code(() => confirmTerms(c.db, { productId: added["personal"]!, input: { ...paper, terms: ["ltv"] }, actor, now }))).toBe("INVALID_INPUT");
    expect(await code(() => confirmTerms(c.db, { productId: 999999, input: { ...paper, terms: ["rate"] }, actor, now }))).toBe("NOT_FOUND");
    expect(await sourcesOf(id)).toEqual([]);
    expect(await eventsAfter(before)).toEqual([]);
    // The oldest day that is still good today is accepted, and good for today only.
    expect(await confirmTerms(c.db, { productId: id, input: { ...paper, terms: ["ltv"], confirmedOn: "2026-08-22" }, actor, now })).toEqual({ terms: ["ltv"], validUntil: "2026-11-22" });
    expect((await seen(id)).terms!.ltv).toMatchObject({ state: "confirmed" });
    expect((await seen(id, later)).terms!.ltv).toMatchObject({ state: "expired" });
  });

  it("takes a confirmation back and leaves the others", async () => {
    const id = added["mortgage"]!;
    await confirmTerms(c.db, { productId: id, input: { ...paper, terms: ["rate", "amount"] }, actor, now });
    const before = await lastId();
    expect(await withdrawTerms(c.db, { productId: id, terms: ["rate", "tenor"], actor })).toEqual({ terms: ["rate"] });
    expect((await sourcesOf(id)).map((row) => row.term)).toEqual(["ltv", "amount"]);
    expect(await eventsAfter(before)).toEqual([{ action: "lender.terms_withdraw", entity: "product", entityId: id, details: { lender: "البنك العربي الوطني", product: "التمويل العقاري", terms: ["rate"] } }]);
    // Nothing to take back writes nothing.
    expect(await withdrawTerms(c.db, { productId: id, terms: ["rate"], actor })).toEqual({ terms: [] });
    expect(await withdrawTerms(c.db, { productId: id, terms: [], actor })).toEqual({ terms: [] });
    expect(await eventsAfter(before)).toHaveLength(1);
    expect(await code(() => withdrawTerms(c.db, { productId: 999999, terms: ["rate"], actor }))).toBe("NOT_FOUND");
  });

  it("keeps the sources of a product that is stopped, for the day it is put back", async () => {
    const id = added["mortgage"]!;
    await setProductActive(c.db, { productId: id, active: false, actor });
    expect((await sourcesOf(id)).map((row) => row.term)).toEqual(["ltv", "amount"]);
    const kept = (await listCatalogue(c.db, { stopped: true, now })).flatMap((lender) => lender.products).find((p) => p.id === String(id))!;
    expect(kept.terms!.amount).toMatchObject({ state: "confirmed", strength: "written" });
    await setProductActive(c.db, { productId: id, active: true, actor });
    expect((await seen(id)).terms!.amount).toMatchObject({ state: "confirmed" });
  });
});
