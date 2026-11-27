import "server-only";
import crypto from "node:crypto";

/**
 * WhatsApp from the company's own number, through Meta's Cloud API. It works only once the owner
 * sets these in the deployment, and stays off without them:
 *
 * - `WA_TOKEN`: a system user's permanent token.
 * - `WA_PHONE_ID`: the id of the phone number.
 * - `WA_APP_SECRET`: the app's secret. Every call Meta makes to the webhook is signed with it.
 * - `WA_VERIFY_TOKEN`: a word of the owner's choosing, asked for once when the webhook is registered.
 * - `WA_TEMPLATE`, `WA_TEMPLATE_LANG`, `WA_OTP_TEMPLATE`, `WA_API_VERSION`: optional names.
 */
export interface CloudConfig {
  token: string;
  phoneId: string;
  version: string;
  /** The approved template that invites a client to reply. Its body takes a first name and a link. */
  template: string;
  templateLang: string;
  /** The approved authentication template that carries a sign-in code. */
  codeTemplate: string;
}

type Env = Record<string, string | undefined>;

export function cloudConfig(env: Env = process.env): CloudConfig | null {
  if (!env.WA_TOKEN || !env.WA_PHONE_ID) return null;
  return {
    token: env.WA_TOKEN,
    phoneId: env.WA_PHONE_ID,
    version: env.WA_API_VERSION || "v21.0",
    template: env.WA_TEMPLATE || "masar_file_update",
    templateLang: env.WA_TEMPLATE_LANG || "ar",
    codeTemplate: env.WA_OTP_TEMPLATE || "masar_login_code",
  };
}

export type Sent = { ok: true; id: string } | { ok: false; error: string };

export interface CloudMedia {
  bytes: Uint8Array;
  mime: string;
}

/** What the rest of the system asks of WhatsApp. Tests hand in a made-up one. */
export interface Cloud {
  template: string;
  /** Free text. Meta delivers it only while the person wrote within the last day. */
  sendText(to: string, body: string): Promise<Sent>;
  /** The approved template, with the client's first name and their link. */
  sendTemplate(to: string, params: string[]): Promise<Sent>;
  /** A sign-in code, in the authentication template. */
  sendCode(to: string, code: string): Promise<Sent>;
  /** A picture or a document a person sent. Null when it cannot be fetched or is larger than `maxBytes`. */
  media(id: string, maxBytes: number): Promise<CloudMedia | null>;
}

const TEXT_MAX = 4096;

export function cloud(config: CloudConfig, fetcher: typeof fetch = fetch): Cloud {
  const base = `https://graph.facebook.com/${config.version}`;
  const auth = { Authorization: `Bearer ${config.token}` };

  async function send(payload: Record<string, unknown>): Promise<Sent> {
    let response: Response;
    try {
      response = await fetcher(`${base}/${config.phoneId}/messages`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      return { ok: false, error: `network: ${String((error as Error)?.message ?? error).slice(0, 200)}` };
    }
    const answer = (await response.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } };
    const id = answer.messages?.[0]?.id;
    if (response.ok && id) return { ok: true, id };
    const said = answer.error?.message ? `${answer.error.message}${answer.error.code ? ` (${answer.error.code})` : ""}` : `HTTP ${response.status}`;
    return { ok: false, error: said.slice(0, 300) };
  }

  const template = (name: string, components: unknown[]) => ({ type: "template", template: { name, language: { code: config.templateLang }, components } });

  return {
    template: config.template,
    sendText: (to, body) => send({ to, type: "text", text: { preview_url: true, body: body.slice(0, TEXT_MAX) } }),
    sendTemplate: (to, params) =>
      send({
        to,
        // A template parameter takes no line breaks.
        ...template(config.template, [{ type: "body", parameters: params.map((text) => ({ type: "text", text: text.replace(/\s*\n+\s*/g, " ").slice(0, 900) })) }]),
      }),
    sendCode: (to, code) =>
      send({
        to,
        ...template(config.codeTemplate, [
          { type: "body", parameters: [{ type: "text", text: code }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
        ]),
      }),
    async media(id, maxBytes) {
      try {
        const about = await fetcher(`${base}/${encodeURIComponent(id)}`, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(15_000) });
        const meta = (await about.json().catch(() => ({}))) as { url?: string; mime_type?: string; file_size?: number };
        if (!about.ok || !meta.url || !meta.url.startsWith("https://")) return null;
        if ((meta.file_size ?? 0) > maxBytes) return null;
        const file = await fetcher(meta.url, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(30_000) });
        if (!file.ok) return null;
        const bytes = new Uint8Array(await file.arrayBuffer());
        return bytes.length > maxBytes ? null : { bytes, mime: (meta.mime_type ?? "").split(";")[0]!.trim() };
      } catch {
        return null;
      }
    },
  };
}

/** True when a webhook call carries Meta's signature over its exact body. */
export function signedByMeta(appSecret: string | undefined | null, raw: string, header: string | null): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const want = Buffer.from(`sha256=${crypto.createHmac("sha256", appSecret).update(raw).digest("hex")}`);
  const got = Buffer.from(header);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** True when the call that registers the webhook carries the word the owner chose. */
export function registersWebhook(verifyToken: string | undefined | null, mode: string | null, token: string | null): boolean {
  if (!verifyToken || mode !== "subscribe" || !token) return false;
  const want = Buffer.from(verifyToken);
  const got = Buffer.from(token);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
