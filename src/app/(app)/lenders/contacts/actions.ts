"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { addContact, checkContact, stopContact } from "@/server/requests/service";
import { DomainError } from "@/server/shared/errors";

export type ContactAnswer = { error?: string; saved?: boolean };

const id = z.coerce.number().int().positive();
const text = (form: FormData, key: string): string | null => String(form.get(key) ?? "").trim() || null;

function refresh(): void {
  revalidatePath("/lenders/contacts");
  revalidatePath("/lenders/requests");
  revalidatePath("/deals/[id]/requests", "page");
}

async function step(run: () => Promise<unknown>): Promise<ContactAnswer> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    throw error;
  }
  refresh();
  return { saved: true };
}

/** Keeps a new way of reaching a lender. The service checks every value. */
export async function saveContact(_before: ContactAnswer, form: FormData): Promise<ContactAnswer> {
  const actor = await requireActor("lender.manage");
  const lenderId = id.safeParse(String(form.get("lenderId") ?? "").replace(/^l/, ""));
  if (!lenderId.success) return { error: "INVALID_INPUT" };
  const input = {
    lenderId: lenderId.data,
    kind: text(form, "kind"),
    value: text(form, "value") ?? "",
    person: text(form, "person"),
    source: text(form, "source"),
    checkedOn: text(form, "checkedOn"),
  };
  return step(async () => addContact(await getDb(), { input, actor }));
}

/** Says someone checked that a way still reaches its lender, and against what. */
export async function confirmContact(contactId: number, _before: ContactAnswer, form: FormData): Promise<ContactAnswer> {
  const actor = await requireActor("lender.manage");
  return step(async () =>
    checkContact(await getDb(), {
      contactId,
      input: {
        source: text(form, "source") ?? "",
        checkedOn: text(form, "checkedOn") ?? "",
      },
      actor,
    }),
  );
}

/** Stops a way the office no longer uses. */
export async function stopIt(contactId: number, _before: ContactAnswer, _form: FormData): Promise<ContactAnswer> {
  const actor = await requireActor("lender.manage");
  return step(async () => stopContact(await getDb(), { contactId, actor }));
}
