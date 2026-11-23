import "server-only";

/**
 * What a deployment does around the build of the site, decided from where it runs.
 *
 * The site is deployed by pushing: a branch gets a preview, `main` goes live. Nobody runs a command
 * against the live database by hand, so the steps that need it are steps of the deployment itself, and
 * a step that fails stops the deployment: the site that is live stays live.
 *
 * - On the branch `rehearsal`, before the build: the move of the old data is rehearsed. It reads the old
 *   database and writes to no real one.
 * - On a production build, before the build: the settings a live site cannot run without are checked,
 *   and pending migrations are applied.
 * - On a production build, after the build: with `MASAR_MOVE_OLD_DATA=yes` the old system's data is
 *   moved, once. Either way a site with no account to sign in to does not go live.
 */
export type ReleasePhase = "before" | "after";
export type ReleaseStep = "rehearse" | "migrate" | "move" | "accounts";

export interface ReleasePlan {
  steps: ReleaseStep[];
  /** Why this deployment must not go on. Null when it may. */
  refuse: string | null;
  /** Where the old data is read from, for the steps that read it. */
  legacyUrl: string | null;
}

/** The branch whose preview rehearses the move. No other preview reads the old database. */
export const REHEARSAL_BRANCH = "rehearsal";

type Env = Record<string, string | undefined>;

export function planRelease(phase: ReleasePhase, env: Env): ReleasePlan {
  const production = env.VERCEL_ENV === "production";
  const target = env.MASAR_DATABASE_URL || null;

  if (!production) {
    // The rehearsal reads the old database by the names the old system itself reads it by.
    const legacyUrl = env.LEGACY_DATABASE_URL || env.DATABASE_URL || env.POSTGRES_URL || null;
    const rehearse = phase === "before" && env.VERCEL_GIT_COMMIT_REF === REHEARSAL_BRANCH;
    if (rehearse && !legacyUrl) return { steps: [], refuse: "the rehearsal has no database to read: none of LEGACY_DATABASE_URL, DATABASE_URL and POSTGRES_URL is set for this branch", legacyUrl: null };
    return { steps: rehearse ? ["rehearse"] : [], refuse: null, legacyUrl: rehearse ? legacyUrl : null };
  }

  const missing = [
    !target && "MASAR_DATABASE_URL",
    (env.MASAR_SECRET ?? "").length < 16 && "MASAR_SECRET (at least 16 characters, the value the old system runs on)",
    !env.MASAR_ORIGINS && "MASAR_ORIGINS (the site's addresses, without which nobody's passkey works)",
  ].filter((name): name is string => typeof name === "string");
  if (missing.length) return { steps: [], refuse: `production is missing ${missing.join(", ")}`, legacyUrl: null };

  if (phase === "before") return { steps: ["migrate"], refuse: null, legacyUrl: null };
  // The old tables live beside the new ones unless another database is named for them.
  const move = env.MASAR_MOVE_OLD_DATA === "yes";
  return { steps: move ? ["move", "accounts"] : ["accounts"], refuse: null, legacyUrl: move ? env.LEGACY_DATABASE_URL || target : null };
}
