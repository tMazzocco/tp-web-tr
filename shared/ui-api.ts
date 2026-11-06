import { type Express, type Request, type Response } from 'express';
import axios from "axios";
import { sleep } from 'bun';
import { logger } from './route-logger';
import type { HSStorage } from './hs-storage';
import type { IngressSources } from './ingress';


class UIController {
    public constructor(private hsStorage: HSStorage, mqtt: IngressSources) {

    }

    @logger('health')
    async getHealth(request: Request, response: Response) {

    }

    @logger('pong')
    async getPong(request: Request, response: Response) {

    }
}

// export function registerHealthCheckRoutes(app: Express, hsStorage: HSStorage): void {
//     console.log("Registering Health routes ...");
//     const ctrl = new HealthController(hsStorage);
//     app.get('/health', (request, response) => ctrl.getHealth(request, response));
// }

