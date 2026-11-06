import { type Express, type Request, type Response } from 'express';
import axios from "axios";
import { HSStorage, HSState } from './hs-storage.ts';
import { sleep } from 'bun';
import { logger } from './route-logger.ts';


// export function registerHandshakeRoutes(app: Express, hsStorage: HSStorage, serverIp: string): void {
//     console.log("Registering handshake routes");
//     // ------SYN-------- 
//     app.post('/syn', async (req: Request, res: Response) => {
//         const origin = req.get('Origin'); // string | undefined
//         console.log('Request origin:', origin);

//         res.send({ status: 200 });
//         try {
//             hsStorage.setSyn(
//                 origin as string
//             );
//             console.log("Sending /syn-ack back");
//             const response = await axios({
//                 method: 'post',
//                 url: `${origin}/syn-ack`,
//                 headers: {
//                     'Origin': `${serverIp}`
//                 }
//             });
//             console.log("Response from client:", response.data);
//         } catch (error) {
//             console.error("Error fetching data from the server:", error);
//         }
//     });

//     // ------SYN-ACK--------
//     app.post('/syn-ack', async (req: Request, res: Response) => {
//         const origin = req.get('Origin'); // string | undefined
//         console.log('Request SYNC ACK origin:', origin);
//         res.send({ status: 200 });
//         console.log("Syn-ack successful");

//         try {
//             hsStorage.setSynAck(origin as string);

//             const response = await axios({
//                 method: 'post',
//                 headers: {
//                     'Origin': `${serverIp}`
//                 },
//                 url: `${hsStorage.getHandshake(origin as string)?.toUrl()}/ack`
//             })
//             console.log("Handshake completed successfully with", origin);
//         } catch (error) {
//             console.error("Error syncing with the server:", error);
//         }
//     });

//     // ------ACK--------
//     app.post('/ack', (req: Request, res: Response, ) => {
//         const origin = req.get('Origin'); // string | undefined
//         console.log('Request ACK origin:', origin);
//         hsStorage.setAck(origin as string);
//         res.send({ status: 200 });
//         console.log("Received ACK from client", origin);
//         console.log("HS State", hsStorage.getHandshake(origin as string)?.getState() as string);
//     });

//     // ------CLOSE--------
//     app.post('/forget', (req: Request, res: Response) => {
//         const origin = req.get('Origin'); // string | undefined
//         console.log('Request origin:', origin);
//         res.send({ status: 200 });
//         hsStorage.closeHandshake(origin as string);
//         console.log("Handshake closed with", origin);
//     });
// }

export async function handShakeWithServer(
    hsStorage: HSStorage,
    target: string,
    localOrigin: string
): Promise<HSState> {
    console.log("Initiating handshake with", target);
    return await initHandshake(target, localOrigin, hsStorage);
}

export async function initHandshake(target: string, localOrigin: string, hs: HSStorage): Promise<HSState> {
    hs.setState(target, HSState.SYN);
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

export async function closeHandshake(hsStorage: HSStorage, target: string, localOrigin: string): Promise<void> {
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

export function verifyHandshake(hsStorage: HSStorage, target: string): boolean {
    const state = hsStorage.state(target);
    const ok = state === HSState.ACK || state === HSState.SYN_ACK;
    if (!ok)
        console.warn(`[HandShake] verify failed for ${target}: state=${state}`);
    return ok;
}


class HandShakeControler {
    constructor(private hs: HSStorage, private ip: String) {

    }

    @logger('syn')
    async postSyn(req: Request, res: Response) {
        const origin = req.get('Origin'); // string | undefined
        res.send({ status: 200 });

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
        const origin = req.get('Origin') || ""; // string | undefined
        if (origin === "") {
            res.status(400).send({ status: 400, message: "Missing Origin header" });
            return;
        }
        if (this.hs.state(origin) !== HSState.SYN) {
            res.status(409).send({ status: 409, message: `Unexpected SYN-ACK, state is ${this.hs.state(origin)}` });
            return;
        }
        res.send({ status: 200 });

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
        console.log('Request ACK origin:', origin);
        this.hs.setState(origin as string, HSState.ACK);
        res.send({ status: 200 });
        console.log("HS State", this.hs.getHandshake(origin as string)?.getState() as string);

    }

    @logger('forget')
    async postForget(req: Request, res: Response) {
        const origin = req.get('Origin');
        res.send({ status: 200 });
        this.hs.closeHandshake(origin as string);
        console.log("Handshake closed with", origin);
    }
}

export function registerHandShakeRoutes(app: Express, hsStorage: HSStorage, ip: String): void {
    console.log("Resgistering HandShake Routes ...")
    const controller = new HandShakeControler(hsStorage, ip);
    app.post('/syn', (req, res) => controller.postSyn(req, res));
    app.post('/syn-ack', (req, res) => controller.postSynAck(req, res));
    app.post('/ack', (req, res) => controller.postAck(req, res));
    app.post('/forget', (req, res) => controller.postForget(req, res));

}