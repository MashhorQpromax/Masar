import { dataMode, getDb } from "@/server/db/client";
import { registersWebhook, signedByMeta } from "@/server/messages/cloud";
import { whatsapp } from "@/server/messages/request";
import { receive } from "@/server/messages/service";
import { DomainError } from "@/server/shared/errors";

export const dynamic = "force-dynamic";

/** Meta registers the webhook once, with the word the owner chose. */
export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  if (!registersWebhook(process.env.WA_VERIFY_TOKEN, query.get("hub.mode"), query.get("hub.verify_token"))) return new Response("Forbidden", { status: 403 });
  return new Response(query.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
}

const MAX_BYTES = 1024 * 1024;

/**
 * Meta reports here: what clients wrote, and how the office's messages are doing. Nobody is signed
 * in on this door, so the signature over the exact body is the only thing that opens it.
 */
export async function POST(request: Request): Promise<Response> {
  // The demo holds made-up clients and takes in nothing from outside.
  if (dataMode() === "demo") return new Response("Not found", { status: 404 });
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return new Response("Too large", { status: 413 });
  if (!signedByMeta(process.env.WA_APP_SECRET, raw, request.headers.get("x-hub-signature-256"))) return new Response("Bad signature", { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  try {
    await receive(await getDb(), { payload, cloud: whatsapp() });
  } catch (error) {
    // A report that cannot be read is not sent again: Meta repeats what gets no 200.
    if (!(error instanceof DomainError)) throw error;
  }
  return new Response("OK", { status: 200 });
}
