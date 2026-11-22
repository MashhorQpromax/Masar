import "server-only";
import bcrypt from "bcryptjs";

/** bcrypt at the cost the old system used, so the passwords people already have keep working. */
const COST = 12;

export const hashPassword = (password: string): Promise<string> => bcrypt.hash(password, COST);

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/** A real hash at the same cost, of a random text nobody knows. It matches no password. */
export const DECOY_HASH = "$2b$12$bDd03if5j51BEfP/VfywVu2OL6GJ2xqYuyXrs2FD6JnmBpa8hdReq";

/**
 * Spends the time of a real check when there is no account to check against, so the answer for an
 * unknown email takes as long as the answer for a wrong password.
 */
export async function spendPasswordCheck(password: string): Promise<void> {
  await bcrypt.compare(password, DECOY_HASH);
}

export const hashCost = (hash: string): number => bcrypt.getRounds(hash);
