import { createDiffieHellmanGroup, DiffieHellmanGroup } from "crypto";

export class Keygeneration {
  private dh: DiffieHellmanGroup;
  private publicKey: string;

  constructor() {
    this.dh = createDiffieHellmanGroup("modp14");
    this.publicKey = this.dh.generateKeys("base64");
  }

  getPublicKey(): string {
    return this.publicKey;
  }

  computeSecret(peerPublicKey: string): string {
    return this.dh.computeSecret(peerPublicKey, "base64", "base64");
  }
}
