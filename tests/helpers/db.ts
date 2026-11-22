import { connect, type Connection } from "@/server/db/client";

/** A fresh in-memory Postgres with every migration applied. */
export async function testDb(): Promise<Connection> {
  const connection = await connect("pglite:");
  await connection.migrate();
  return connection;
}
