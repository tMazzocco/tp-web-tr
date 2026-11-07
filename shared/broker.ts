import { type Express, type Request, type Response } from 'express';
import axios, { Axios } from "axios";
import { HSStorage, HSState, } from './hs-storage.ts';
import { sleep } from 'bun';
import { logger } from './route-logger.ts';
import type { IngressMessage } from './ingress.ts';
import type { HsService } from './handshake.ts';
import type { Message } from 'postcss';
import type { ToolsService } from './tools.ts';
import type { Encryption } from './diffi/encrypter.ts';
import { sendMessageCryptedToServer } from './ingress.ts';


let TTL_TIME = 120_000;

export class Client {
    private lastSeen: Date = new Date();
    private publicKey: string | undefined;
    private url: string;
    private name: string;

    constructor(name: string, url: string, pubK?: string) {
        this.url = url;
        this.name = name;
        this.publicKey = pubK;
    }

    public getUrl(): string {
        return this.url;
    }

    public getName(): string {
        return this.name;
    }

    public getLastSeen(): Date {
        return this.lastSeen;
    }

    public getPublicKey(): string | undefined {
        return this.publicKey;
    }


    public setPublicKey(pubK: string): void {
        this.publicKey = pubK;
    }

    public touch(): void {
        this.lastSeen = new Date();
    }
}


export class ClientRegistry {
    private storage: Map<string, Client>;

    constructor() {
        this.storage = new Map<string, Client>();
    }

    public registerClient(c: Client) {
        const idemClient: Client = this.storage.get(c.getName()) || c;
        if (idemClient == c) {
            this.storage
        }
        idemClient.touch();
    }

    public isDnsFound(clientId: string): boolean {
        return this.storage.get(clientId) ? true : false;
    }

    public insertToDns(clientId: string, clientUrl: string, pubK?: string): Client {
        const existing = this.storage.get(clientId);
        if (existing) {
            if (pubK) existing.setPublicKey(pubK);
            existing.touch();
            return existing;
        }
        const newClient = new Client(clientId, clientUrl, pubK);
        this.storage.set(clientId, newClient);
        return newClient;
    }

    public resolveDns(clientId: string): Client | undefined {
        return this.storage.get(clientId);
    }

    public getAll(): Client[] {
        return [... this.storage.values()]
    }
}

// TTL should be included at the construction
class MessageStamp {
    public hash: string;
    public ttl: number;

    constructor(hash: string) {
        this.hash = hash;
        this.ttl = Date.now() + TTL_TIME;
    }
}

// Done ?
class ProcessedMessagePile {
    public processed: MessageStamp[] = [];
    private maxSize: number = 1000;

    public isProcessedOrAdd(hash: string): boolean {
        if (this.processed.some((e) => e.hash == hash))
            return true;

        const arrLen = this.processed.push(new MessageStamp(hash));
        if (arrLen > this.maxSize)
            this.processed.shift();

        return false;
    }

    public purgeFromTimestamp(t: number) {
        while (this.processed.length > 0 && this.processed[0]!.ttl < t) {
            this.processed.shift();
        }
    }
}

export class BrokerMessagePileWorker {

    constructor(
        private pendingPile: PendingMessagePile,
        private processedPile: ProcessedMessagePile
    ) { }

    public async unPile() {
        this.pendingPile.pendingPile.forEach(message => {

        });
        this.processedPile.purgeFromTimestamp(Date.now())
    }
}

class PendingMessage {
    public message: IngressMessage;
    public retryLeft: number = 5;

    constructor(m: IngressMessage) {
        this.message = m;
    }
}

class PendingMessagePile {
    public pendingPile: Map<string, PendingMessage> = new Map<string, PendingMessage>();

    public addPending(m: IngressMessage, key: string) {
        this.pendingPile.set(key, new PendingMessage(m));
    }

    public rmPending(key: string) {
        this.pendingPile.delete(key);
    }
}

export class Broker {
    private crRegistry: ClientRegistry;
    private processedMessagePile: ProcessedMessagePile = new ProcessedMessagePile();
    private pendingMessagePile: PendingMessagePile = new PendingMessagePile();
    private hs: HsService;
    private localIp: string;
    private serverId: string;
    private tools: ToolsService;
    public pileWorker: BrokerMessagePileWorker;
    private encryption: Encryption;

    constructor(hs: HsService, t: ToolsService, ip: string, id: string, e: Encryption, cr: ClientRegistry) {
        this.hs = hs;
        this.localIp = ip;
        this.serverId = id;
        this.tools = t;
        this.pileWorker = new BrokerMessagePileWorker(this.pendingMessagePile, this.processedMessagePile);
        this.encryption = e;
        this.crRegistry = cr;
    }

    // Done
    // client = clientId ; origin = originUrl
    public async connectP2P(client: string, origin: string) {
        const clientFound = this.crRegistry.resolveDns(client)
            || this.crRegistry.insertToDns(client, origin);

        if (this.hs.hsStorage.state(clientFound.getUrl()) !== HSState.ACK)
            this.hs.handShakeWithServer(clientFound.getUrl(), this.localIp);

        try {
            const r = await axios({
                "method": "post",
                "url": clientFound.getUrl() + "/broker/register/" + this.serverId,
                "headers": {
                    "Origin": this.localIp
                },
                "data": {
                    "publicKey": this.encryption.getPublicKey()
                }
            })
            if (r.data?.publicKey)
                clientFound.setPublicKey(r.data.publicKey);

        } catch (error) {
            const msg = axios.isAxiosError(error) ? error.message : String(error);
            console.warn(`[Connection p2p] → ${client} failed: ${msg}`);
        }
    }

    public distributeMessage(message: IngressMessage) {
        const messageHash = this.tools.hashIngressMessage(message);
        if (this.processedMessagePile.isProcessedOrAdd(messageHash))
            return;
        this.pendingMessagePile.addPending(message, messageHash);
        // To complete strategies or stratifies in parallel de-piler

    }

    public resgisterToDns(clientId: string, clientUrl: string, pubK?: string): string {
        this.crRegistry.insertToDns(clientId, clientUrl, pubK);
        return this.encryption.getPublicKey();
    }

    public setProcessed(hash: string): boolean {
        const isNEw = !this.processedMessagePile.isProcessedOrAdd(hash);
        this.pendingMessagePile.rmPending(hash);
        return isNEw;
    }

    public async broadcastProcessed(hash: string) {
        try {

            const peers = this.crRegistry.getAll();
            peers.forEach(peer => {
                const url = peer.getUrl();
                axios.post(`${url}/broker/processed`, { hash }, {
                    headers: { Origin: this.localIp },
                    timeout: 5_000,
                })
            });
        } catch (error) {
            console.error(`[processed] → failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    public async notifyProcessed(message: IngressMessage): Promise<void> {
        const hash = this.tools.hashIngressMessage(message);
        this.setProcessed(hash);
        await this.broadcastProcessed(hash);
    }

    public async sendToPeer(peerId: string, action: string, payload?: Record<string, unknown>): Promise<boolean> {
        const peer = this.crRegistry.resolveDns(peerId);
        if (!peer)
            throw new Error(`Unknown peers "${peerId}"`);

        return sendMessageCryptedToServer(this.encryption, peer.getUrl(), peer.getName(), this.localIp, {
            action,
            metadata: { source: this.localIp, target: peer.getUrl(), timestamp: new Date().toISOString() },
            payload,
        }, 1);
    }

    public getPeers() {
        return this.crRegistry.getAll().map(c => ({
            id: c.getName(),
            url: c.getUrl(),
            hasKey: !!c.getPublicKey(),
            handshake: this.hs.hsStorage.state(c.getUrl()),
        }));
    }


}

export class BrokerController {

    constructor(private b: Broker) { }

    // Decorator broken because of params
    // @logger('broker/syn/{id}')
    async postSyn(rq: Request<{ id: string }>, rs: Response) {
        try {
            const { id } = rq.params;
            const origin = rq.get('Origin');
            if (!origin) {
                rs.status(400).send({ status: 400, message: 'Missing Origin header' });
                return;
            }

            await this.b.connectP2P(id, origin);
            rs.send({ status: 200 });

        } catch (error) {
            rs.status(400).send({ status: 400, message: error instanceof Error ? error.message : String(error) });
        }
    }

    // @logger('broker/register')
    async postRegister(rq: Request<{ id: string }>, rs: Response) {
        try {
            const { id } = rq.params;
            const origin = rq.get('Origin');
            if (!origin) {
                rs.status(400).send({ status: 400, message: 'Missing Origin header' });
                return;
            }
            const pk = rq.body?.publicKey;
            const key = this.b.resgisterToDns(id, origin, pk);
            rs.send({ status: 200, "publicKey": key });

        } catch (error) {
            rs.status(400).send({ status: 400, message: error instanceof Error ? error.message : String(error) });
        }
    }

    @logger("broker/processed")
    async postProcessed(rq: Request, rs: Response) {
        const hash = rq.body?.hash;
        if (typeof hash !== 'string') {
            rs.status(400).send({ status: 400, message: 'Missing hash' });
            return;
        }
        rs.send({ status: 200 });
        if (this.b.setProcessed(hash))
            this.b.broadcastProcessed(hash);
    }

    // @logger("broker/processed")
    async postSend(rq: Request<{ peerId: string }>, rs: Response) {
        try {
            const ok = await this.b.sendToPeer(
                rq.params.peerId,
                rq.body?.action ?? '/test',
                rq.body?.payload,
            );
            rs.status(ok ? 200 : 502).send({ status: ok ? 200 : 502, ok });
        } catch (error) {
            rs.status(404).send({ status: 404, message: error instanceof Error ? error.message : String(error) });
        }
    }

    @logger("broker/peers")
    async getPeers(_rq: Request, rs: Response) {
        rs.send(this.b.getPeers());
    }


}

export function registerBrokerRoutes(app: Express, broker: Broker): void {
    console.log("Resgistering Broker Routes ...")
    const controller = new BrokerController(broker);
    app.post('/broker/syn/:id', (req, res) => controller.postSyn(req, res));
    app.post('/broker/register/:id', (req, res) => controller.postRegister(req, res));
    app.post('/broker/processed', (req, res) => controller.postProcessed(req, res));
    app.post('/broker/send/:peerId', (req, res) => controller.postSend(req, res));
    app.get('/broker/peers', (req, res) => controller.getPeers(req, res));

}

