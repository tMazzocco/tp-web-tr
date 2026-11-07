import express, { type Express } from 'express';
import { HsService, registerHandShakeRoutes } from '../shared/handshake';
import { registerHealthCheckRoutes } from '../shared/healthcheck';
import { HSState, HSStorage } from '../shared/hs-storage';
import { IngressSources, registerIngressRoutes } from '../shared/ingress';
import { startBrokerPileWorkerLoop, startHealthCheckLoop } from '../shared/background-loops';
import { Broker } from '../shared/broker';
import { ToolsService } from '../shared/tools';

export const thisServerPort = 3000;
export const thisServerIp = 'https://capable-papers-rush-jake.trycloudflare.com';
// export const target = `https://8j1n18z7-3000.uks1.devtunnels.ms`;
export const target = `https://longest-hist-supporting-possession.trycloudflare.com`;
export const thisServerId = "Theo"

// ---------SERVER------------

const app: Express = express();
app.use(express.json());

app.get('/', (_req, res) => {
	res.send('Hello World! From 1');
});


let hsStorage = new HSStorage();
let ingressSources = new IngressSources();

let hsService = new HsService(hsStorage);
let tools = new ToolsService();

let broker = new Broker(
	hsService,
	tools,
	thisServerIp,
	thisServerId
);

registerHandShakeRoutes(app, hsService, thisServerIp);
registerHealthCheckRoutes(app, hsService);
registerIngressRoutes(app, hsService, ingressSources);


console.info(`Server is running on port ${thisServerPort}`);
app.listen(thisServerPort);
let ct = new AbortSignal();

startBrokerPileWorkerLoop(broker, 1_000, ct);
startHealthCheckLoop(hsService, 20_000, ct);
