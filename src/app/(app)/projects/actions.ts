"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { can } from "@/domain/auth";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { openProject, saveProject } from "@/server/projects/service";
import { DomainError } from "@/server/shared/errors";

const formSchema = z.object({
  /** The project's file, or null for a new project. */
  clientId: z.number().int().positive().nullable(),
  /** The mobile of an owner whose file is being opened. */
  phone: z.string().max(40).nullable().default(null),
  project: z.unknown(),
});

/**
 * Saves the project form: a new file for a project and its owner, or new facts for a project that has
 * one. The service checks every value and works the study out again; nothing computed in the browser
 * is trusted. On success the person lands on the study, which takes the form's place in the history.
 * A refusal comes back as a code.
 */
export async function saveProjectForm(form: unknown): Promise<{ error: string; params?: Record<string, string> }> {
  const actor = await requireActor();
  const parsed = formSchema.safeParse(form);
  if (!parsed.success) return { error: "INVALID_INPUT" };
  const { clientId, phone, project } = parsed.data;
  if (!can(actor.role, clientId == null ? "client.create" : "client.edit")) return { error: "FORBIDDEN" };

  let saved: number;
  try {
    const db = await getDb();
    saved = clientId != null ? (await saveProject(db, { clientId, input: project, actor })).clientId : (await openProject(db, { input: project, phone, actor })).clientId;
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code, params: error.params };
    throw error;
  }
  revalidatePath("/clients");
  revalidatePath(`/clients/${saved}`);
  revalidatePath(`/clients/${saved}/project`);
  redirect(`/clients/${saved}/project`, RedirectType.replace);
}
