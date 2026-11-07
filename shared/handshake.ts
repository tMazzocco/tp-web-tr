import { type Express, type Request, type Response } from 'express';
import axios from "axios";
import { HSStorage, HSState } from './hs-storage.ts';
import { logger } from './route-logger.ts';

export class HsService {
    public hsStorage: HSStorage;

    constructor(hsStorage: HSStorage) {
        this.hsStorage = hsStorage;
    }

    public async handShakeWithServer(
        target: string,
        localOrigin: string
    ): Promise<HSState> {
        console.log("Initiating handshake with", target);
        return await this.initHandshake(target, localOrigin);
    }

    public async initHandshake(target: string, localOrigin: string): Promise<HSState> {
        this.hsStorage.setState(target, HSState.SYN);
        try {
            const response = await axios({
                method: 'post',
                url: `${target}/syn`,
                headers: {
                    'Origin': localOrigin
                }
            });
            console.log("Response from server:", response.status);
            return HSState.SYN;
        } catch (error) {
            console.error(`syn → ${target} failed:`, axios.isAxiosError(error) ? error.message : error);
            return HSState.NONE;
        }
    }

    public async closeHandshake(hsStorage: HSStorage, target: string, localOrigin: string): Promise<void> {
        try {
            const response = await axios({
                method: 'post',
                url: `${target}/forget`,
                headers: {
                    'Origin': localOrigin
                }
            });
            console.log("Response from server:", response.data);
            hsStorage.closeHandshake(target);
        }
        catch (error) {
            console.error(`forget → ${target} failed:`, axios.isAxiosError(error) ? error.message : error);
        }
    }

    public verifyHandshake(hsStorage: HSStorage, target: string): boolean {
        const state = hsStorage.state(target);
        const ok = state === HSState.ACK || state === HSState.SYN_ACK;
        if (!ok)
            console.warn(`[HandShake] verify failed for ${target}: state=${state}`);
        return ok;
    }
}


class HandShakeControler {
    constructor(private hs: HSStorage, private ip: String) {

    }

    private getSynOrigin(req: Request, res: Response): string | undefined {
        const origin = req.get('Origin');
        if (!origin) {
            res.status(400).send({ status: 400, message: "Missing Origin header" });
            return undefined;
        }
        if (this.hs.state(origin) !== HSState.SYN) {
            res.status(403).send({ status: 403, message: `Unexpected SYN-ACK, state is ${this.hs.state(origin)}` });
            return undefined;
        }
        return origin;
    }

    @logger('syn')
    async postSyn(req: Request, res: Response) {
        const origin = req.get('Origin'); // string | undefined
        if (!origin) {
            res.status(400).send({ status: 400, message: "Missing Origin header" });
            return;
        }
        res.send({ status: 202 });

        try {
            this.hs.setState(origin as string, HSState.SYN);
            console.log("Sending /syn-ack back");
            const response = await axios({
                method: 'post',
                url: `${origin}/syn-ack`,
                headers: {
                    'Origin': `${this.ip}`
                }
            });
        } catch (error) {
            console.error(`syn-ack → ${origin} failed:`, axios.isAxiosError(error) ? error.message : error);
        }
    }

    @logger('syn-ack')
    async postSynAck(req: Request, res: Response) {
        const origin = this.getSynOrigin(req, res);
        if (!origin) return;
        res.send({ status: 202 });

        try {
            this.hs.setState(origin as string, HSState.SYN_ACK);

            await axios({
                method: 'post',
                headers: {
                    'Origin': `${this.ip}`
                },
                url: `${this.hs.getHandshake(origin as string)?.toUrl()}/ack`
            })
            console.log("Handshake completed successfully with", origin);
        } catch (error) {
            console.error("Error syncing with the server:", error);
        }
    }

    @logger('ack')
    async postAck(req: Request, res: Response) {
        const origin = req.get('Origin'); // string | undefined
        if (!origin) {
            res.status(400).send({ status: 400, message: "Missing Origin header" });
            return;
        }
        if (this.hs.state(origin) !== HSState.SYN) {
            res.status(403).send({ status: 403, message: `Unexpected SYN-ACK, state is ${this.hs.state(origin)}` });
            return;
        }
        console.log('Request ACK origin:', origin);
        this.hs.setState(origin as string, HSState.ACK);
        res.send({ status: 204 });
        console.log("HS State", this.hs.getHandshake(origin as string)?.getState() as string);

    }

    @logger('forget')
    async postForget(req: Request, res: Response) {
        const origin = this.getSynOrigin(req, res);
        if (!origin) return;
        res.send({ status: 204 });
        this.hs.closeHandshake(origin as string);
        console.log("Handshake closed with", origin);
    }
}

export function registerHandShakeRoutes(app: Express, hsService: HsService, ip: String): void {
    console.log("Resgistering HandShake Routes ...")
    const controller = new HandShakeControler(hsService.hsStorage, ip);
    app.post('/syn', (req, res) => controller.postSyn(req, res));
    app.post('/syn-ack', (req, res) => controller.postSynAck(req, res));
    app.post('/ack', (req, res) => controller.postAck(req, res));
    app.post('/forget', (req, res) => controller.postForget(req, res));

}