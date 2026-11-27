/** Who is performing a change. Recorded in the audit log. */
export interface Actor {
  userId: number | null;
  ip?: string | null;
}

export const SYSTEM: Actor = { userId: null };
