import "server-only";
import { desc, eq } from "drizzle-orm";
import { heldGaps } from "@/domain/documents";
import { projectStudy, type GapCode, type ProjectFacts, type ProjectStudy } from "@/domain/project";
import { createClient, type ClientRow } from "../clients/service";
import type { Db, Tx } from "../db/client";
import { clients } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { projectFactsOf, projectInputSchema, type ProjectInput } from "./input";
import { checkedPapers } from "./papers";

/** The kind of file a project is kept as. A project is a client's file with no salary and no deal. */
export const PROJECT_FILE = "project";

export const isProjectFile = (client: Pick<ClientRow, "financeType">): boolean => client.financeType === PROJECT_FILE;

/** A project as its page shows it: the file, what is known, what it asks for, and what the study says. */
export interface ProjectView {
  client: ClientRow;
  facts: ProjectFacts;
  requested: number;
  study: ProjectStudy;
  /** The codes of the file's papers that were checked and stand as good. */
  checked: string[];
  /** The gaps those papers answer. The study no longer asks for them. */
  held: GapCode[];
  /** The file was rejected and waits, as it is, for someone to reopen it. */
  rejected: boolean;
}

/** A project's file is rejected by the mark on the file itself: it has no deal to carry it. */
export const isRejected = (client: Pick<ClientRow, "status">): boolean => client.status === "rejected";

function validated(input: unknown): ProjectInput {
  const parsed = projectInputSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

/**
 * The study of a project file, with the gaps its checked papers answer taken out. The study is worked
 * out again on every read, so it never goes stale.
 */
export function projectOf(client: ClientRow, checked: readonly string[] = []): ProjectView {
  const facts = projectFactsOf(client.extra);
  const requested = client.requestedAmount ?? 0;
  const held = heldGaps(
    facts,
    checked.map((code) => ({ code, status: "verified" as const })),
  );
  return { client, facts, requested, study: projectStudy(facts, requested, held), checked: [...checked], held: [...held], rejected: isRejected(client) };
}

/** The studies of several files at once, each read against its own checked papers. A file that is not a project is left out. */
export async function projectsOf(db: Tx, rows: readonly ClientRow[]): Promise<Map<number, ProjectView>> {
  const projects = rows.filter(isProjectFile);
  const checked = await checkedPapers(
    db,
    projects.map((client) => client.id),
  );
  return new Map(projects.map((client) => [client.id, projectOf(client, checked.get(client.id))]));
}

/** A client's project. Null when there is no such file, or the file is not a project. */
export async function getProject(db: Db, clientId: number): Promise<ProjectView | null> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  return client ? ((await projectsOf(db, [client])).get(client.id) ?? null) : null;
}

/** Every project file, the most recently changed first. */
export async function listProjects(db: Db): Promise<ProjectView[]> {
  const rows = await db.select().from(clients).where(eq(clients.financeType, PROJECT_FILE)).orderBy(desc(clients.updatedAt), desc(clients.id));
  const studied = await projectsOf(db, rows);
  return rows.map((client) => studied.get(client.id)!);
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
    // A rejected file waits as it stood when it was rejected. It is reopened first, with the reason.
    if (isRejected(before)) throw new DomainError("FILE_REJECTED", `client ${before.id}`);
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
