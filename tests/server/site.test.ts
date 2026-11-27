import { describe, expect, it } from "vitest";
import { partyFrom } from "@/server/auth/passkeys";
import { applicationSecret, liveDatabaseUrl, PRODUCTION_ORIGINS, secretIsSet, siteOrigins } from "@/server/site";

/**
 * What the live site knows about itself. The production site runs with none of its own settings, on
 * what the hosting already holds for it. Nothing else ever does.
 */
describe("the live database", () => {
  it("is the one named for this system, wherever it runs", () => {
    expect(liveDatabaseUrl({ MASAR_DATABASE_URL: "postgres://own", DATABASE_URL: "postgres://held" })).toBe("postgres://own");
    expect(liveDatabaseUrl({ VERCEL_ENV: "production", MASAR_DATABASE_URL: "postgres://own", DATABASE_URL: "postgres://held" })).toBe("postgres://own");
  });

  it("is the one the hosting names, on the production site only", () => {
    expect(liveDatabaseUrl({ VERCEL_ENV: "production", DATABASE_URL: "postgres://a", POSTGRES_URL: "postgres://b" })).toBe("postgres://a");
    expect(liveDatabaseUrl({ VERCEL_ENV: "production", POSTGRES_URL: "postgres://b" })).toBe("postgres://b");
    expect(liveDatabaseUrl({ VERCEL_ENV: "production" })).toBeNull();
  });

  it("is never found by a preview or a development machine that was not given it by name", () => {
    for (const where of ["preview", "development", undefined]) {
      expect(liveDatabaseUrl({ VERCEL_ENV: where, DATABASE_URL: "postgres://a", POSTGRES_URL: "postgres://b" })).toBeNull();
    }
  });
});

describe("the site's addresses", () => {
  it("are the ones it is told, else the production site's own", () => {
    expect(siteOrigins({ MASAR_ORIGINS: "https://example.sa" })).toBe("https://example.sa");
    expect(siteOrigins({ VERCEL_ENV: "production", MASAR_ORIGINS: "https://example.sa" })).toBe("https://example.sa");
    expect(siteOrigins({ VERCEL_ENV: "production" })).toBe(PRODUCTION_ORIGINS);
    expect(siteOrigins({ VERCEL_ENV: "preview" })).toBeNull();
    expect(siteOrigins({})).toBeNull();
  });

  it("bind passkeys to the site's own address and take its www twin", () => {
    expect(partyFrom(PRODUCTION_ORIGINS)).toEqual({ id: "masarfin.com", origins: ["https://masarfin.com", "https://www.masarfin.com"] });
  });
});

describe("the application secret", () => {
  const set = "a-secret-of-sixteen-or-more";

  it("is the one set for it, wherever it runs", () => {
    expect(applicationSecret({ MASAR_SECRET: set })).toBe(set);
    expect(applicationSecret({ VERCEL_ENV: "production", MASAR_SECRET: set, DATABASE_URL: "postgres://a" })).toBe(set);
    expect(secretIsSet({ MASAR_SECRET: set })).toBe(true);
    expect(secretIsSet({ MASAR_SECRET: "short" })).toBe(false);
    expect(secretIsSet({})).toBe(false);
  });

  it("is worked out from the database's address on a production site that has none", () => {
    const worked = applicationSecret({ VERCEL_ENV: "production", DATABASE_URL: "postgres://user:pass@host/db" })!;
    expect(worked).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(worked).not.toContain("pass");
    // The same address gives the same secret, by whichever name it comes.
    expect(applicationSecret({ VERCEL_ENV: "production", MASAR_DATABASE_URL: "postgres://user:pass@host/db" })).toBe(worked);
    expect(applicationSecret({ VERCEL_ENV: "production", POSTGRES_URL: "postgres://user:pass@host/db" })).toBe(worked);
    // A secret too short to use is not used.
    expect(applicationSecret({ VERCEL_ENV: "production", MASAR_SECRET: "short", DATABASE_URL: "postgres://user:pass@host/db" })).toBe(worked);
    // Another address, another secret.
    expect(applicationSecret({ VERCEL_ENV: "production", DATABASE_URL: "postgres://user:other@host/db" })).not.toBe(worked);
  });

  it("is not made up anywhere else", () => {
    expect(applicationSecret({ VERCEL_ENV: "production" })).toBeNull();
    expect(applicationSecret({ VERCEL_ENV: "preview", MASAR_DATABASE_URL: "postgres://own" })).toBeNull();
    expect(applicationSecret({ MASAR_DATABASE_URL: "postgres://own", MASAR_SECRET: "short" })).toBeNull();
    expect(applicationSecret({})).toBeNull();
  });
});
