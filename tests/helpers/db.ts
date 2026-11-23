import postgres from "postgres";
import { connect, type Connection } from "@/server/db/client";

let made = 0;

/**
 * A fresh Postgres with every migration applied.
 *
 * In memory by default. With `MASAR_TEST_DATABASE_URL` naming a Postgres server it is a new database
 * on that server, reached through the driver production uses and dropped when the test closes it:
 * `MASAR_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm test`.
 */
export async function testDb(): Promise<Connection> {
  const server = process.env.MASAR_TEST_DATABASE_URL;
  if (!server) {
    const connection = await connect("pglite:");
    await connection.migrate();
    return connection;
  }

  const name = `masar_test_${process.pid}_${Date.now()}_${made++}`;
  const onServer = async (statement: string) => {
    const admin = postgres(server, { max: 1, onnotice: () => {} });
    try {
      await admin.unsafe(statement);
    } finally {
      await admin.end({ timeout: 5 });
    }
  };
  await onServer(`CREATE DATABASE ${name}`);
  const url = new URL(server);
  url.pathname = `/${name}`;
  const connection = await connect(url.toString());
  await connection.migrate();
  return {
    ...connection,
    close: async () => {
      await connection.close();
      await onServer(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    },
  };
}
