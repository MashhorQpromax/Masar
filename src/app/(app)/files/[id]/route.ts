import { FILE_MIME } from "@/domain/documents";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { openPaperFile } from "@/server/documents/service";

export const dynamic = "force-dynamic";

const gone = () => new Response(null, { status: 404 });

/**
 * A kept file, for a person who may see a client's private details. It is sent as what its own bytes
 * said it is, never cached, and every opening is recorded.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await requireActor("client.view_pii");
  const fileId = Number((await params).id);
  if (!Number.isInteger(fileId) || fileId <= 0) return gone();
  const file = await openPaperFile(await getDb(), { fileId, actor });
  if (!file) return gone();
  return new Response(file.bytes as BodyInit, {
    headers: {
      "Content-Type": FILE_MIME[file.kind],
      "Content-Length": String(file.bytes.length),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
