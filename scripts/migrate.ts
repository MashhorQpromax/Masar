// Applies pending migrations from db/migrations. Usage: MASAR_DATABASE_URL=... npm run db:migrate
import { connect, databaseUrl } from "../src/server/db/client";

const connection = await connect(databaseUrl());
try {
  await connection.migrate();
  console.log("migrations applied");
} finally {
  await connection.close();
}
