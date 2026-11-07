// Source => https://medium.com/cuesoft/end-to-end-encryption-in-nodejs-using-diffiehelman-algorithm-9c412be86d2
// Adapted to our needs
import {
  type BinaryLike,
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "crypto";
import { Keygeneration } from "./crypt";
import type { ClientRegistry } from "../broker";

const ALGO = "aes-256-gcm" as const;

export class Encrypter {
  private key: Buffer;

  constructor(secret: BinaryLike, salt: BinaryLike) {
    this.key = Buffer.from(hkdfSync("sha256", secret, salt, "p2p-payload", 32));
  }

  encrypt(clearText: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(clearText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [encrypted.toString("hex"), iv.toString("hex"), tag.toString("hex")].join("|");
  }

  decrypt(encryptedText: string): string {
    const [encrypted, iv, tag] = encryptedText.split("|");
    if (!encrypted || !iv || !tag) throw new Error("Malformed payload");
    const decipher = createDecipheriv(ALGO, this.key, Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "hex")),
      decipher.final(),
    ]).toString("utf8");
  }
}

export type EncryptedPayload = { payload: string; salt: string };

export class Encryption {
  private keys = new Keygeneration();
  // clientId -> { peer key, gen secret }
  private secrets = new Map<string, { peerKey: string; secret: string }>();

  constructor(private cRegistry: ClientRegistry) {}

  getPublicKey(): string {
    return this.keys.getPublicKey();
  }

  private secretFor(clientId: string): string {
    const peerKey = this.cRegistry.resolveDns(clientId)?.getPublicKey();
    if (!peerKey) throw new Error(`No public key known for client "${clientId}"`);

    const cached = this.secrets.get(clientId);
    if (cached && cached.peerKey === peerKey) return cached.secret;

    const secret = this.keys.computeSecret(peerKey);
    this.secrets.set(clientId, { peerKey, secret });
    return secret;
  }

  encryptPayload(clientId: string, payload: unknown): EncryptedPayload {
    const salt = randomBytes(16).toString("base64");
    const enc = new Encrypter(this.secretFor(clientId), salt);
    return { payload: enc.encrypt(JSON.stringify(payload)), salt };
  }

  decryptPayload(clientId: string, data: EncryptedPayload): Record<string, unknown> {
    const enc = new Encrypter(this.secretFor(clientId), data.salt);
    return JSON.parse(enc.decrypt(data.payload)) as Record<string, unknown>;
  }
}
