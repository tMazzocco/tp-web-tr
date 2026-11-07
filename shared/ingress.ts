import { type Express, type Request, type Response } from 'express';
import { logger } from './route-logger.ts';
import axios from 'axios';
import { sleep } from 'bun';
import type { HsService } from './handshake.ts';
import type { EncryptedPayload, Encrypter, Encryption } from './diffi/encrypter.ts';
import type { Broker } from './broker.ts';

let KNOW_TOPICS = [
    "/test"
]

export class IngressMessage {
    constructor(
        public topic: string,
        public origin: string,
        public tEmission: Date,
        public target: string,
        public payload?: Record<string, unknown>,
        public tReception: number = Date.now()
    ) { }

    static fromIngressBody(body: IngressBody): IngressMessage {
        return new IngressMessage(
            body.topic,
            body.metadata.source,
            body.metadata.timestamp,
            body.metadata.target,
            body.payload
        );
    }

    toBodyMessage() {
        return {
            action: this.topic,
            metadata: {
                source: this.origin,
                target: this.target,
                timestamp: this.tEmission.toString(),
            },
            payload: this.payload,
        };
    }

}

class IngressQueue {
    private queue: IngressMessage[] = [];

    public push(message: IngressMessage): void {
        this.queue.push(message);
    }
}

export class IngressSources {
    private sources: Map<string, IngressQueue>;
    constructor() {
        this.sources = new Map<string, IngressQueue>();
        // Initialize known topics
        KNOW_TOPICS.forEach(e => {
            this.sources.set(e, new IngressQueue());
        });
    }

    isSourceKnown(topic: string): boolean {
        return this.sources.has(topic);
    }

    pushMessageOnTopic(ingressMessage: IngressMessage): void {
        const queue = this.sources.get(ingressMessage.topic);
        if (!queue)
            throw new Error(`Unknown topic "${ingressMessage.topic}"`);
        queue.push(ingressMessage);
    }
}


function handleIngressMessage(ingressMessage: IngressBody, ingressSources: IngressSources): IngressMessage {
    const m = IngressMessage.fromIngressBody(ingressMessage);
    ingressSources.pushMessageOnTopic(m);
return m;
    
}

export interface IngressBody {
    metadata: {
        source: string,
        timestamp: Date,
        target: string
    }
    topic: string;
    payload?: Record<string, unknown>;
}

export function parseIngressBody(body: unknown, crypt: Encryption): IngressBody {
    // if (typeof body !== 'object' || body === null || Array.isArray(body))
    //     crypt.decryptPayload(peerId, body as EncryptedPayload);
    if (typeof body !== 'object' || body === null || Array.isArray(body))
        throw new Error("Body mal formed");
    
    const b = body as Record<string, unknown>;
    const errors: string[] = [];

    // action
    if (typeof b.action !== 'string' || b.action.trim() === '')
        errors.push('action: required non-empty string');

    // metadata
    if (typeof b.metadata !== 'object' || b.metadata === null || Array.isArray(b.metadata))
        throw new Error('metadata: required object');
    const m = b.metadata as Record<string, unknown>;

    // metadata.source
    let source: string  = "none"
    if (typeof m.source !== 'string') errors.push('metadata.source: required URL string');
    else
        source = m.source

    // metadata.timestamp
    let timestamp: Date | undefined;
    if (typeof m.timestamp !== 'string' && typeof m.timestamp !== 'number')
        errors.push('metadata.timestamp: required ISO string or epoch ms');
    else {
        timestamp = new Date(m.timestamp);
        if (isNaN(timestamp.getTime())) errors.push(`metadata.timestamp: invalid date "${m.timestamp}"`);
    }

    // metadata.target
    if (typeof m.target !== 'string' || m.target.trim() === '')
        errors.push('metadata.target: required non-empty string');

    // payload
    let payload: Record<string, unknown> | undefined;
    if (b.payload !== undefined && source !== "none") {
        try {
            payload = crypt.decryptPayload(source, b.payload as EncryptedPayload);
        } catch {
            errors.push('payload: cannot decrypt');
        }
    }


    if (errors.length) 
        throw new Error(errors.join(',\n'));


    return {
        topic: b.action as string,
        payload: payload,
        metadata: {
            source: source!,
            timestamp: timestamp!,
            target: m.target as string,
        }
    };
}

class IngressControler {
    constructor(
        private hsService: HsService,
        private topics: IngressSources,
        private crypt: Encryption,
        private broker: Broker
    ) { }

    @logger('ingress')
    async postMessage(req: Request, res: Response) {
        try {
            const origin = req.get('Origin') ?? 'unknown';
            
            if (!this.hsService.verifyHandshake(this.hsService.hsStorage, origin)) {
                res.status(400).send({ message: 'Forbidden' });
                return;
            }

            const cleanedBody: IngressBody = parseIngressBody(req.body, this.crypt);
            const m = handleIngressMessage(cleanedBody, this.topics);

            res.send({ status: 201 });
            this.broker.notifyProcessed(m)
        } catch (error) {

            res.status(400).send({ status: 400, message: error instanceof Error ? error.message : String(error) });
        }
    }
}

export function registerIngressRoutes(app: Express, hsService: HsService, ingressSources: IngressSources, e: Encryption, b: Broker): void {
    console.log("Resgistering Ingress Routes ...")
    const controller = new IngressControler(hsService, ingressSources,  e, b);
    app.post('/ingress', (req, res) => controller.postMessage(req, res));

}

export async function sendMessageToServer(
    target: string,
    localOrigin: string,
    messageBody: unknown,
    retries = 3
): Promise<boolean> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await axios.post(`${target}/ingress`, messageBody, {
                headers: { Origin: localOrigin },
                timeout: 5_000,
            });
            return true;
        } catch (error) {
            const msg = axios.isAxiosError(error) ? error.message : String(error);
            console.warn(`[ingress] → ${target} attempt ${attempt}/${retries} failed: ${msg}`);
            if (attempt < retries)
                await sleep(500 * attempt);
        }
    }
    return false;
}

export async function sendMessageCryptedToServer(
    crypt: Encryption,
    target: string,          // peer URL
    targetPeerId: string,    // peer id
    localOrigin: string,     // server URL
    messageBody: {
        action: string;
        metadata: { source: string; target: string; timestamp: string };
        payload?: Record<string, unknown>;
    },
    retries = 3,
): Promise<boolean> {
    let body: unknown = messageBody;
    if (messageBody.payload !== undefined) {
        try {
            body = { ...messageBody, payload: crypt.encryptPayload(targetPeerId, messageBody.payload) };
        } catch (error) {
            console.warn(`[ingress] → ${target} encryption failed: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
    return sendMessageToServer(target, localOrigin, body, retries);
}



