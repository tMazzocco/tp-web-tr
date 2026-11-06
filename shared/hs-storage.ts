export enum HSState {
    NONE = "NONE",
    SYN = "SYN",
    SYN_ACK = "SYN-ACK",
    ACK = "ACK",
    DOWN = "DOWN"
}

export class HS {
    private state: HSState;
    private origin: string;

    constructor(origin: string) {
        this.state = HSState.NONE;
        this.origin = origin;
    }

    public getState(): HSState {
        return this.state;
    }

    public getOrigin(): string {
        return this.origin;
    }

    public setState(state: HSState): void {
        this.state = state;
    }

    public toUrl(): string {
        return `${this.origin}`;
    }
}

export class HSStorage {
    private storage: Map<string, HS>;

    constructor() {
        this.storage = new Map<string, HS>();
    }

    public state(key: string): HSState {
        return this.storage.get(key)?.getState() ?? HSState.NONE;
    }

    public getHandshake(key: string): HS | undefined {
        return this.storage.get(key);
    }

    public getConnections(): HS[] {
        return Array.from(this.storage.values());
    }

    public setState(key: string, state: HSState): void {
        let handshake = this.storage.get(key);
        if (!handshake) {
            handshake = new HS(key);
            this.storage.set(key, handshake);
        }
        console.log(`[HS] ${key}: ${handshake.getState()} → ${state}`);
        handshake.setState(state);
    }

    public closeHandshake(key: string): void {
        this.setState(key, HSState.DOWN);
    }
}