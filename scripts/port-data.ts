// Moves the old system's data into the rebuild. Steps and what to check are in docs/MIGRATION.md.
//
//   LEGACY_DATABASE_URL=... MASAR_SECRET=... npm run data:port -- --rehearse
//   LEGACY_DATABASE_URL=... MASAR_DATABASE_URL=... MASAR_SECRET=... npm run data:port
//   LEGACY_DATABASE_URL=... MASAR_DATABASE_URL=... MASAR_SECRET=... npm run data:port -- --write
//
// --rehearse runs the whole move into a throwaway database and writes to no real one.
// Without a flag it is a dry run: it reads, checks and reports, and writes nothing anywhere.
// --write makes the move. Run after the move, it writes nothing and says whether the old tables changed since.
// The old tables are only ever read. The report names rows by their ids and nobody by name.
import { parseArgs } from "node:util";
import { unseal } from "../src/server/auth/secret";
import { connect, databaseUrl } from "../src/server/db/client";
import { rehearse } from "../src/server/port/rehearse";
import { portData, reportLines, safeError } from "../src/server/port/run";

const { values } = parseArgs({ options: { write: { type: "boolean", default: false }, rehearse: { type: "boolean", default: false } } });
if (values.write && values.rehearse) throw new Error("--write and --rehearse do not go together");

// The old database is named on its own, on purpose. Nothing here falls back to DATABASE_URL.
const legacyUrl = process.env.LEGACY_DATABASE_URL;
if (!legacyUrl) throw new Error("LEGACY_DATABASE_URL is not set");

const secret = process.env.MASAR_SECRET ?? "";
const opens = secret.length >= 16 ? (sealed: string) => unseal(sealed) != null : undefined;
const now = new Date();

let ready = false;
if (values.rehearse) {
  const legacy = await connect(legacyUrl);
  try {
    const result = await rehearse({ legacy: legacy.db, now, opens });
    for (const line of reportLines(result, { rehearsal: true })) console.log(line);
    ready = result.wrote;
  } catch (error) {
    console.error(safeError(error));
  } finally {
    await legacy.close();
  }
} else {
  const targetUrl = databaseUrl();
  const target = await connect(targetUrl);
  const legacy = legacyUrl === targetUrl ? target : await connect(legacyUrl);
  try {
    const result = await portData({ legacy: legacy.db, target: target.db, write: values.write, now, opens });
    for (const line of reportLines(result)) console.log(line);
    ready = result.moved ? result.moved.changed.length === 0 : !result.findings.some((finding) => finding.level === "stop");
  } catch (error) {
    console.error(safeError(error));
  } finally {
    if (legacy !== target) await legacy.close();
    await target.close();
  }
}
process.exit(ready ? 0 : 1);
