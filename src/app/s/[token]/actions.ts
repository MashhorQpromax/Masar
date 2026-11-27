"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FILE_MAX_BYTES } from "@/domain/documents";
import { requestOrigin } from "@/server/auth/request";
import { dataMode, getDb } from "@/server/db/client";
import { portalUpload } from "@/server/messages/portal";
import { linkPath } from "@/server/messages/request";
import { DomainError } from "@/server/shared/errors";

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const codeSchema = z.string().min(1).max(60);

/**
 * Keeps one file the client sends through their link. Nobody is signed in here: the link in the
 * address is the key, and the service checks it again along with the paper and the file.
 */
export async function sendPaper(token: string, code: string, formData: FormData): Promise<{ error?: string }> {
  // The demo holds invented clients and is open to anyone with its address. A real paper is never taken there.
  if (dataMode() === "demo") return { error: "DEMO" };
  const link = tokenSchema.safeParse(token);
  const paper = codeSchema.safeParse(code);
  const file = formData.get("file");
  if (!link.success) return { error: "LINK_CLOSED" };
  if (!paper.success) return { error: "INVALID_INPUT" };
  if (!(file instanceof File) || file.size === 0) return { error: "NO_FILE" };
  if (file.size > FILE_MAX_BYTES) return { error: "FILE_TOO_LARGE" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { ip } = await requestOrigin();
  try {
    await portalUpload(await getDb(), { token: link.data, code: paper.data, file: { name: file.name, bytes }, ip });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    throw error;
  }
  revalidatePath(linkPath(link.data));
  return {};
}
