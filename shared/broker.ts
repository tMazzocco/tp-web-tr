import { type Express, type Request, type Response } from 'express';
import axios, { Axios } from "axios";
import { HSStorage, HSState, } from './hs-storage.ts';
import { sleep } from 'bun';
import { logger } from './route-logger.ts';
import type { IngressMessage } from './ingress.ts';
import type { HsService } from './handshake.ts';
import type { Message } from 'postcss';
import type { ToolsService } from './tools.ts';

let TTL_TIME = 120;

export class Client {
    private lastSeen: Date = new Date();
    private publicKey: string = "none";
    private url: string;
    private name: string;

    constructor(name: string, url: string, pubK: string) {
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

    public getPublicKey(): string {
        return this.publicKey;
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

    public insertToDns(clientId: string, clientUrl: string): Client {
        const newClient = new Client(clientId, clientUrl, "undefined")
        this.storage.set(clientId, newClient);
        return newClient;
    }

    public resolveDns(clientId: string): Client | undefined {
        return this.storage.get(clientId);
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
        if (this.processed.filter((e) => e.hash == hash))
            return true;

        const arrLen = this.processed.push(new MessageStamp(hash));
        if (arrLen > this.maxSize)
            this.processed.shift();

        return false;
    }

    public purgeFromTimestamp(t: number) {
        let security = 0;
        if (this.processed.length == 0)
            return;

        while(security <= this.maxSize) {
            if (this.processed[0]!.ttl < t) {
                this.processed.shift();
            }
        }
    }
}

export class BrokerMessagePileWorker {
    
    constructor(
        private pendingPile: PendingMessagePile,
         private processedPile: ProcessedMessagePile
        ) {}

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
    private crRegistry: ClientRegistry = new ClientRegistry();
    private processedMessagePile: ProcessedMessagePile = new ProcessedMessagePile();
    private pendingMessagePile: PendingMessagePile = new PendingMessagePile();
    private hs: HsService;
    private localIp: string;
    private serverId: string;
    private tools: ToolsService;
    public pileWorker: BrokerMessagePileWorker;

    constructor(hs: HsService, t: ToolsService, ip: string, id: string) {
        this.hs = hs;
        this.localIp = ip;
        this.serverId = id;
        this.tools = t;
        this.pileWorker = new BrokerMessagePileWorker(this.pendingMessagePile, this.processedMessagePile);
    }

    // Done
    // client = clientId ; origin = originUrl
    public connectP2P(client: string, origin: string) {
        const clientFound = this.crRegistry.resolveDns(client)
            || this.crRegistry.insertToDns(client, origin);

        if (this.hs.hsStorage.state(clientFound.getUrl()) !== HSState.ACK)
            this.hs.handShakeWithServer(this.localIp, clientFound.getUrl());

        try {
            const r = axios({
                "method": "post",
                "url": clientFound.getUrl() + "/broker/register/" + this.serverId,
                "headers": {
                    "Origin": this.localIp
                },
            })
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

    public resgisterToDns(clientId: string, clientUrl: string) {
        this.crRegistry.insertToDns(clientId, clientUrl);
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

            this.b.connectP2P(id, origin);
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
            this.b.resgisterToDns(id, origin);
            rs.send({ status: 200 });

        } catch (error) {
            rs.status(400).send({ status: 400, message: error instanceof Error ? error.message : String(error) });
        }
    }
}

export function registerBrokerRoutes(app: Express, broker: Broker): void {
    console.log("Resgistering Broker Routes ...")
    const controller = new BrokerController(broker);
    app.post('/broker/syn/:id', (req, res) => controller.postSyn(req, res));
    app.post('/broker/register/:id', (req, res) => controller.postRegister(req, res));
}