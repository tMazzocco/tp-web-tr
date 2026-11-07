import { type Express, type Request, type Response } from 'express';
import axios from "axios";
import { sleep } from 'bun';
import { logger } from './route-logger';
import type { HSStorage } from './hs-storage';
import type { HsService } from './handshake';


class HealthController {
    public constructor(private hsStorage: HSStorage) {

    }

    @logger('health')
    async getHealth(request: Request, response: Response) {
        response.send({ status: 204, message: 'Server is healthy' });
    }

    @logger('pong')
    async getPong(request: Request, response: Response) {
        const state = request.body.state || "badState";
        const origin = request.get('Origin') || "";

        if (state == "alive")
            response.send({ status: 204 });
        else {
            this.hsStorage.closeHandshake(origin);
            response.status(410).send({ status: 410, message: 'Handshake closed' });
        }
    }
}

export function registerHealthCheckRoutes(app: Express, hsService: HsService): void {
    console.log("Registering Health routes ...");
    const ctrl = new HealthController(hsService.hsStorage);
    app.get('/health', (request, response) => ctrl.getHealth(request, response));
}


export async function sendHealthCheckRequest(peerOrigin: string): Promise<boolean> {
    let retrySleep = 0;

    while (true) {
        try {
            await axios.get(`${peerOrigin}/health`, { timeout: 5_000 });
            return true;
        } catch (error) {
            retrySleep = retrySleep === 0 ? 1_000 : retrySleep * 2;
            console.warn(`[health] ${peerOrigin} failed (${axios.isAxiosError(error) ? error.message : error}), retry in ${retrySleep}ms`);
            if (retrySleep > 30_000) {
                console.error(`[health] ${peerOrigin} retries exhausted`);
                return false;
            }
            await sleep(retrySleep);
        }
    }
}
