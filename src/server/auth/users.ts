import "server-only";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { passwordProblem, ROLES } from "@/domain/auth";
import { normalizePhone } from "@/domain/shared/phone";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import type { Actor } from "../shared/actor";
import { audit } from "../shared/audit";
import { DomainError } from "../shared/errors";
import { hashPassword, verifyPassword } from "./password";
import { endSessionsOf } from "./sessions";

const userSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().pipe(z.email().max(200)),
  role: z.enum(ROLES),
  phone: z.string().trim().max(20).nullish(),
});

function checkPassword(password: string): void {
  const problem = passwordProblem(password);
  if (problem) throw new DomainError(problem);
}

/** Adds a person to the office. The password is hashed here and never stored or logged as typed. */
export async function createUser(
  db: Db,
  args: { name: string; email: string; role: string; password: string; phone?: string | null; actor: Actor; now?: Date },
): Promise<{ id: number }> {
  const parsed = userSchema.safeParse(args);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { name, email, role } = parsed.data;
  const phone = parsed.data.phone || null;
  if (phone && !normalizePhone(phone)) throw new DomainError("INVALID_INPUT", "phone");
  checkPassword(args.password);
  const passwordHash = await hashPassword(args.password);
  const now = args.now ?? new Date();

  return db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email));
    if (taken) throw new DomainError("EMAIL_TAKEN");
    const [user] = await tx.insert(users).values({ name, email, role, phone, passwordHash, createdAt: now, updatedAt: now }).returning({ id: users.id });
    await audit(tx, args.actor, "user.create", "user", user!.id, { role });
    return { id: user!.id };
  });
}

/**
 * A person changes their own password. Every other session of theirs ends, so a password changed
 * because a device was lost also signs that device out.
 */
export async function changeOwnPassword(
  db: Db,
  args: { userId: number; current: string; next: string; keepToken?: string | null; actor: Actor; now?: Date },
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, args.userId));
  if (!user || !(await verifyPassword(args.current, user.passwordHash))) throw new DomainError("WRONG_PASSWORD");
  checkPassword(args.next);
  const passwordHash = await hashPassword(args.next);
  const now = args.now ?? new Date();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, args.userId));
    await endSessionsOf(tx, args.userId, args.keepToken);
    await audit(tx, args.actor, "user.password", "user", args.userId);
  });
}
