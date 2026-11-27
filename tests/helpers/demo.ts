import { eq } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { clients, documents } from "@/server/db/schema";

/**
 * The demonstration carries one conflict between a file and a checked paper: an identity card that
 * gives another year of birth than the file. It has tests of its own. A test about something else
 * takes it away here, by making every card say what its file says, and reads the clients as their
 * files stand.
 */
export async function withoutDemoConflict(db: Db): Promise<void> {
  const cards = await db
    .select({ id: documents.id, stated: documents.stated, birthYear: clients.birthYear })
    .from(documents)
    .innerJoin(clients, eq(clients.id, documents.clientId))
    .where(eq(documents.code, "id"));
  for (const card of cards) {
    if (card.stated?.birthYear == null || card.birthYear == null) continue;
    await db
      .update(documents)
      .set({ stated: { ...card.stated, birthYear: card.birthYear } })
      .where(eq(documents.id, card.id));
  }
}
