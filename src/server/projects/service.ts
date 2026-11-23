import "server-only";
import { desc, eq } from "drizzle-orm";
import { projectStudy, type ProjectFacts, type ProjectStudy } from "@/domain/project";
import { createClient, type ClientRow } from "../clients/service";
import type { Db } from "../db/client";
import { clients } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { projectFactsOf, projectInputSchema, type ProjectInput } from "./input";

/** The kind of file a project is kept as. A project is a client's file with no salary and no deal. */
export const PROJECT_FILE = "project";

export const isProjectFile = (client: Pick<ClientRow, "financeType">): boolean => client.financeType === PROJECT_FILE;

/** A project as its page shows it: the file, what is known, what it asks for, and what the study says. */
export interface ProjectView {
  client: ClientRow;
  facts: ProjectFacts;
  requested: number;
  study: ProjectStudy;
}

function validated(input: unknown): ProjectInput {
  const parsed = projectInputSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

/** The study of a project file. The study is worked out again on every read, so it never goes stale. */
export function projectOf(client: ClientRow): ProjectView {
  const facts = projectFactsOf(client.extra);
  const requested = client.requestedAmount ?? 0;
  return { client, facts, requested, study: projectStudy(facts, requested) };
}

/** A client's project. Null when there is no such file, or the file is not a project. */
export async function getProject(db: Db, clientId: number): Promise<ProjectView | null> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  return client && isProjectFile(client) ? projectOf(client) : null;
}

/** Every project file, the most recently changed first. */
export async function listProjects(db: Db): Promise<ProjectView[]> {
  const rows = await db.select().from(clients).where(eq(clients.financeType, PROJECT_FILE)).orderBy(desc(clients.updatedAt), desc(clients.id));
  return rows.map(projectOf);
}

/** Opens a file for a project's owner and keeps what is known about the project. */
export async function openProject(db: Db, args: { input: unknown; phone?: string | null; actor: Actor; now?: Date }): Promise<{ clientId: number; study: ProjectStudy }> {
  const input = validated(args.input);
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const client = await createClient(tx, {
      // A project is studied on its land and its income. Its owner's file holds no salary.
      input: { fullName: input.owner, birthYear: null, sector: "self", basicSalary: null, totalSalary: null, serviceMonths: null },
      phone: args.phone,
      file: { financeType: PROJECT_FILE, requestedAmount: input.requested, extra: { ...input.facts } },
      actor: args.actor,
      now,
    });
    await audit(tx, args.actor, "project.save", "client", client.id, { created: true });
    return { clientId: client.id, study: projectStudy(input.facts, input.requested) };
  });
}

/** Changes what is known about a project, its owner's name or what it asks for. The log names what changed and never the values. */
export async function saveProject(db: Db, args: { clientId: number; input: unknown; actor: Actor; now?: Date }): Promise<{ clientId: number; study: ProjectStudy }> {
  const input = validated(args.input);
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(clients).where(eq(clients.id, args.clientId));
    if (!before) throw new DomainError("NOT_FOUND", `client ${args.clientId}`);
    if (!isProjectFile(before)) throw new DomainError("NOT_A_PROJECT", `client ${before.id}`);
    const was = projectFactsOf(before.extra);
    const changed: string[] = [
      ...(before.fullName !== input.owner ? ["owner"] : []),
      ...((before.requestedAmount ?? 0) !== input.requested ? ["requested"] : []),
      ...(Object.keys(input.facts) as (keyof ProjectFacts)[]).filter((key) => was[key] !== input.facts[key]),
    ];
    if (changed.length) {
      await tx
        .update(clients)
        .set({ fullName: input.owner, requestedAmount: input.requested, extra: { ...input.facts }, updatedAt: now })
        .where(eq(clients.id, before.id));
      await audit(tx, args.actor, "project.save", "client", before.id, { changed });
    }
    return { clientId: before.id, study: projectStudy(input.facts, input.requested) };
  });
}
