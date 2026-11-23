import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Connection } from "@/server/db/client";
import { clients, dealItems, deals, users } from "@/server/db/schema";
import { testDb } from "../helpers/db";

let c: Connection;
beforeAll(async () => {
  c = await testDb();
});
afterAll(async () => {
  await c.close();
});

const newClient = async (fileNo: string) => {
  const [row] = await c.db.insert(clients).values({ fileNo, fullName: "عميل تجريبي" }).returning();
  return row!;
};

describe("schema", () => {
  it("creates every table from the migrations", async () => {
    const result = await c.db.execute(sql`select count(*)::int as n from information_schema.tables where table_schema = 'masar'`);
    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { n: number }[];
    expect(rows[0]!.n).toBe(29); // 28 tables + the migrations journal
  });

  it("treats emails as case insensitive", async () => {
    await c.db.insert(users).values({ name: "أ", email: "User@Example.com", passwordHash: "x", role: "admin" });
    await expect(
      c.db.insert(users).values({ name: "ب", email: "user@example.com", passwordHash: "x", role: "viewer" }),
    ).rejects.toThrow();
  });

  it("stores money exactly", async () => {
    const client = await newClient("C-900");
    const [deal] = await c.db.insert(deals).values({ clientId: client.id, propertyValue: 800000.55, fixedCosts: 0.1 }).returning();
    expect(deal!.propertyValue).toBe(800000.55);
    expect(deal!.fixedCosts).toBe(0.1);
    expect(deal!.transferTaxPct).toBe(5);
    expect(deal!.stage).toBe("study");
  });

  it("allows one open deal per client, and a new one after the first closes", async () => {
    const client = await newClient("C-901");
    const [first] = await c.db.insert(deals).values({ clientId: client.id }).returning();
    await expect(c.db.insert(deals).values({ clientId: client.id })).rejects.toThrow();
    await c.db.update(deals).set({ stage: "closed" }).where(eq(deals.id, first!.id));
    await expect(c.db.insert(deals).values({ clientId: client.id })).resolves.toBeDefined();
  });

  it("removes a client's deals and items with the client", async () => {
    const client = await newClient("C-902");
    const [deal] = await c.db.insert(deals).values({ clientId: client.id }).returning();
    await c.db.insert(dealItems).values({ dealId: deal!.id, key: "i1", position: 0, kind: "execution", label: "قرار تنفيذ", original: 100000, pay: 90000, paidBy: "company" });
    await expect(
      c.db.insert(dealItems).values({ dealId: deal!.id, key: "i1", position: 1, kind: "default", label: "مكرر", paidBy: "company" }),
    ).rejects.toThrow();
    await c.db.delete(clients).where(eq(clients.id, client.id));
    expect(await c.db.select().from(dealItems).where(eq(dealItems.dealId, deal!.id))).toHaveLength(0);
  });
});
