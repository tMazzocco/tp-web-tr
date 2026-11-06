import { type Express, type Request, type Response } from 'express';
import { HSStorage, HSState } from './hs-storage.ts';
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
    ) {}

    static fromIngressBody(body: IngressBody): IngressMessage {
        return new IngressMessage(
            body.topic,
            body.source.origin,
            body.timestamp,
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


function handleIngressMessage(ingressMessage: IngressBody, ingressSources: IngressSources, origin: string): void {
    ingressSources.pushMessageOnTopic(IngressMessage.fromIngressBody(ingressMessage));
}

export interface IngressBody {
    topic: string;
    source: URL;
    timestamp: Date;
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

    // source
    let source: URL | undefined;
    if (typeof b.source !== 'string') errors.push('source: required URL string');
    else {
        try { source = new URL(b.source); }
        catch { errors.push(`source: invalid URL "${b.source}"`); }
    }

    // timestamp 
    let timestamp: Date | undefined;
    if (typeof b.timestamp !== 'string' && typeof b.timestamp !== 'number')
        errors.push('timestamp: required ISO string or epoch ms');
    else {
        timestamp = new Date(b.timestamp);
        if (isNaN(timestamp.getTime())) errors.push(`timestamp: invalid date "${b.timestamp}"`);
    }

    // payload
    if (b.payload !== undefined &&
        (typeof b.payload !== 'object' || b.payload === null || Array.isArray(b.payload)))
        errors.push('payload: must be an object if present');

    if (errors.length)
        throw new Error(errors.join(',\n'));
        

    return {
            topic: b.action as string,
            source: source!,
            timestamp: timestamp!,
            payload: b.payload as Record<string, unknown> | undefined,
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
            handleIngressMessage(cleanedBody, this.topics, origin);

            res.send({ status: 200 });
        } catch (error) {

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
