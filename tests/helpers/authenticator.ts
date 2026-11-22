import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest();
const uint = (value: number, bytes: number) => {
  const out = Buffer.alloc(bytes);
  out.writeUIntBE(value, 0, bytes);
  return out;
};

const PRESENT = 0x01;
const VERIFIED = 0x04;
const HAS_KEY = 0x40;

interface Held {
  privateKey: KeyObject;
  userHandle: string;
  count: number;
}

/**
 * A passkey device made of software: it does what a phone's secure chip does when the browser asks,
 * with a real P-256 key, so the server's checks run against true signatures.
 *
 * `origin` is the address the browser is on. `verifies: false` is a device that only notes someone
 * touched it, without a fingerprint or a PIN.
 */
export class Device {
  private held = new Map<string, Held>();

  constructor(
    private origin: string,
    private options: { verifies?: boolean } = {},
  ) {}

  private flags(extra = 0): number {
    return PRESENT | (this.options.verifies === false ? 0 : VERIFIED) | extra;
  }

  private clientData(type: "webauthn.create" | "webauthn.get", challenge: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  /** Makes a passkey, as `navigator.credentials.create` would. `credentialId` forces an id, to try a duplicate. */
  create(options: PublicKeyCredentialCreationOptionsJSON, credentialId?: string): RegistrationResponseJSON {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    const id = credentialId ? Buffer.from(credentialId, "base64url") : randomBytes(16);
    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
        [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
      ]),
    );
    const authData = Buffer.concat([sha256(options.rp.id!), uint(this.flags(HAS_KEY), 1), uint(0, 4), Buffer.alloc(16), uint(id.length, 2), id, cose]);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, string>>([
        ["fmt", "none"],
        ["attStmt", new Map<string, string>()],
        ["authData", new Uint8Array(authData)],
      ]),
    );
    this.held.set(text(id), { privateKey, userHandle: options.user.id, count: 0 });
    return {
      id: text(id),
      rawId: text(id),
      type: "public-key",
      response: { clientDataJSON: text(this.clientData("webauthn.create", options.challenge)), attestationObject: text(attestationObject), transports: ["internal"] },
      clientExtensionResults: {},
    };
  }

  /** Answers a sign-in challenge with the first passkey it holds, or the one named. */
  get(options: PublicKeyCredentialRequestOptionsJSON, credentialId?: string): AuthenticationResponseJSON {
    const id = credentialId ?? [...this.held.keys()][0];
    const key = id ? this.held.get(id) : undefined;
    if (!id || !key) throw new Error("this device holds no such passkey");
    key.count += 1;
    const clientData = this.clientData("webauthn.get", options.challenge);
    const authData = Buffer.concat([sha256(options.rpId!), uint(this.flags(), 1), uint(key.count, 4)]);
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientData)]), key.privateKey);
    return {
      id,
      rawId: id,
      type: "public-key",
      response: { clientDataJSON: text(clientData), authenticatorData: text(authData), signature: text(signature), userHandle: key.userHandle },
      clientExtensionResults: {},
    };
  }
}
