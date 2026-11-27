import "server-only";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { connect, type Db } from "../db/client";
import { portData, type PortArgs, type PortResult } from "./run";

/**
 * The whole move, into a database that is thrown away.
 *
 * A dry run checks what can be checked without writing. A rehearsal goes further: it makes an empty
 * copy of this system's tables in a temporary folder and runs the real move into it, so every row
 * meets every rule of the new tables before the day of the switch. The old data is read inside
 * read-only transactions and nothing is written to any database that outlives the call.
 */
export async function rehearse(args: { legacy: Db; now: Date; opens?: PortArgs["opens"] }): Promise<PortResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "masar-rehearsal-"));
  const target = await connect(`pglite:${dir}`);
  try {
    await target.migrate();
    return await portData({ legacy: args.legacy, target: target.db, write: true, now: args.now, opens: args.opens });
  } finally {
    await target.close();
    await rm(dir, { recursive: true, force: true });
  }
}
