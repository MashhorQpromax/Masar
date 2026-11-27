// What a deployment does before and after `next build`. Run by `npm run vercel-build`, never by hand.
// The decisions are in src/server/port/release.ts and the day of the switch is in docs/MIGRATION.md.
//
//   tsx --conditions=react-server scripts/release.ts before
//   tsx --conditions=react-server scripts/release.ts after
//
// A step that fails ends with a non-zero exit, which fails the deployment: the site that is live stays live.
import { count } from "drizzle-orm";
import { unseal } from "../src/server/auth/secret";
import { connect, type Connection } from "../src/server/db/client";
import { users } from "../src/server/db/schema";
import { rehearse } from "../src/server/port/rehearse";
import { planRelease, type ReleasePhase } from "../src/server/port/release";
import { applicationSecret, liveDatabaseUrl, secretIsSet } from "../src/server/site";
import { mayGoLive, portData, reportLines, safeError } from "../src/server/port/run";

const phase = process.argv[2];
if (phase !== "before" && phase !== "after") throw new Error("say which phase: before or after");

const say = (line: string) => console.log(`[release] ${line}`);
const opens = (sealed: string) => unseal(sealed) != null;
const now = new Date();

async function run(which: ReleasePhase): Promise<boolean> {
  const plan = planRelease(which, process.env);
  if (plan.refuse) {
    say(`STOPPED: ${plan.refuse}`);
    // A rehearsal that cannot start is no reason to hold back the preview it rides on.
    return process.env.VERCEL_ENV !== "production";
  }
  if (!plan.steps.length) {
    say(`${which} the build: nothing to do for this deployment`);
    return true;
  }

  if (plan.steps.includes("rehearse")) {
    const legacy = await connect(plan.legacyUrl!);
    try {
      const result = await rehearse({ legacy: legacy.db, now, opens: applicationSecret() ? opens : undefined });
      for (const line of reportLines(result, { rehearsal: true })) say(line);
    } catch (error) {
      say(`REHEARSAL FAILED: ${safeError(error)}`);
    } finally {
      await legacy.close();
    }
    return true;
  }

  const targetUrl = liveDatabaseUrl()!;
  const target: Connection = await connect(targetUrl);
  try {
    if (plan.steps.includes("migrate")) {
      if (!process.env.MASAR_DATABASE_URL) say("the database is the one the hosting names for the production site");
      if (!secretIsSet()) say("MASAR_SECRET is not set: the application secret is worked out from the database's address, and changes if that address does");
      await target.migrate();
      say("migrations applied");
    }
    if (plan.steps.includes("move")) {
      const legacy = plan.legacyUrl === targetUrl ? target : await connect(plan.legacyUrl!);
      try {
        const result = await portData({ legacy: legacy.db, target: target.db, write: true, now, opens });
        for (const line of reportLines(result)) say(line);
        if (!mayGoLive(result)) {
          say("STOPPED: the old system's data is not in this one, so this deployment does not go live");
          return false;
        }
      } finally {
        if (legacy !== target) await legacy.close();
      }
    }
    if (plan.steps.includes("accounts")) {
      const [held] = await target.db.select({ n: count() }).from(users);
      if (!held?.n) {
        say("STOPPED: there is no account to sign in to. Make the first account with `npm run user:create`");
        return false;
      }
    }
    return true;
  } finally {
    await target.close();
  }
}

let ok = false;
try {
  ok = await run(phase);
} catch (error) {
  say(`FAILED: ${safeError(error)}`);
}
process.exit(ok ? 0 : 1);
