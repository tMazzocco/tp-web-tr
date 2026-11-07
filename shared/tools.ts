import type { IngressMessage } from "./ingress";
import { createHash, hash } from 'node:crypto';

export class ToolsService {
    public hashIngressMessage(message: IngressMessage): string {
    const hashBase = JSON.stringify([
        message.topic,
        message.origin,
        message.target,
        message.tEmission.toString(),
        message.payload ?? null,
    ]);
    return createHash('sha256').update(hashBase).digest('hex');
}

}