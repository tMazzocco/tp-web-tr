import { type Express, type Request, type Response } from 'express';
import { HSStorage } from './hs-storage.ts';
import { verifyHandshake } from './handshake.ts';
import { logger } from './route-logger.ts';
import axios from 'axios';
import { sleep } from 'bun';

let KNOW_TOPICS = [
    "/test"
]

export class IngressMessage {
    constructor(
        public topic: string,
        public origin: string,
        public tEmission: Date,
        public payload?: Record<string, unknown>,
        public tReception: number = Date.now(),
    ) { }

    static fromIngressBody(body: IngressBody): IngressMessage {
        return new IngressMessage(
            body.topic,
            body.metadata.source.origin,
            body.metadata.timestamp,
            body.payload,
        );
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


function handleIngressMessage(ingressMessage: IngressBody, ingressSources: IngressSources): void {
    ingressSources.pushMessageOnTopic(IngressMessage.fromIngressBody(ingressMessage));
}

export interface IngressBody {
    metadata: {
        source: URL,
        timestamp: Date,
        target: string
    }
    topic: string;
    payload?: Record<string, unknown>;
}

export function parseIngressBody(body: unknown): IngressBody {
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
    let source: URL | undefined;
    if (typeof m.source !== 'string') errors.push('metadata.source: required URL string');
    else {
        try { source = new URL(m.source); }
        catch { errors.push(`metadata.source: invalid URL "${m.source}"`); }
    }

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
    if (b.payload !== undefined &&
        (typeof b.payload !== 'object' || b.payload === null || Array.isArray(b.payload)))
        errors.push('payload: must be an object if present');

    if (errors.length)
        throw new Error(errors.join(',\n'));


    return {
        topic: b.action as string,
        payload: b.payload as Record<string, unknown> | undefined,
        metadata: {
            source: source!,
            timestamp: timestamp!,
            target: m.target as string,
        }
    };
}


class IngressControler {
    constructor(private hs: HSStorage, private topics: IngressSources) {

    }

    @logger('ingress')
    async postMessage(req: Request, res: Response) {
        try {
            const origin = req.get('Origin') ?? 'unknown';
            if (!verifyHandshake(this.hs, origin)) {
                res.status(403).send({ message: 'Forbidden' });
                return;
            }

            const cleanedBody: IngressBody = parseIngressBody(req.body);
            handleIngressMessage(cleanedBody, this.topics);

            res.send({ status: 200 });
        } catch (error) {
            res.status(400).send({ status: 400, message: error instanceof Error ? error.message : String(error) });
        }
    }
}

export function registerIngressRoutes(app: Express, hsStorage: HSStorage, ingressSources: IngressSources): void {
    console.log("Resgistering Ingress Routes ...")
    const controller = new IngressControler(hsStorage, ingressSources);
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
