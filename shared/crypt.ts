import type { IngressMessage } from "./ingress";

export class CryptService {
    private salt: string;
    private privateKey;
    
    constructor(salt: string, pk: string) {
        this.salt = salt;
        this.privateKey = pk;
    }

    public encryptIngressMessage(message: IngressMessage, targetPubKey: string): IngressMessage {
        // WIP
        return message;
    }

    public decryptIngressMessage(message: IngressMessage, enderPubkey: string): IngressMessage {
        //WIP
        return message;
    }
}