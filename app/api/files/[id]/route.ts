import fs from "node:fs/promises";
import path from "node:path";
import { get } from "@/lib/db";
import { currentUser, audit } from "@/lib/auth";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return new Response("Unauthorized", { status: 401 });
  const d = await get<{ id: number; client_id: number; stored_name: string | null; file_name: string; mime: string }>("SELECT * FROM documents WHERE id = ?", Number((await params).id));
  if (!d?.stored_name) return new Response("Not found", { status: 404 });
  let buf: Uint8Array;
  if (d.stored_name.startsWith("db:")) {
    const b = await get<{ data: Uint8Array }>("SELECT data FROM file_blobs WHERE doc_id = ?", d.id);
    if (!b) return new Response("Not found", { status: 404 });
    buf = b.data;
  } else {
    // ملفات قديمة محفوظة على القرص (نسخة التطوير المحلية)
    buf = await fs.readFile(path.join(process.cwd(), "data", "uploads", path.basename(d.stored_name)));
  }
  await audit(u, "doc_download", "client", d.client_id, { doc: d.id, name: d.file_name });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": d.mime,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(d.file_name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
