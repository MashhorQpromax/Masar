import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./db/migrations",
  casing: "snake_case",
  schemaFilter: ["masar"],
  migrations: { schema: "masar", table: "schema_migrations" },
});
