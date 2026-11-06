import express, { type Express, type Request, type Response } from 'express';
import { registerHandShakeRoutes } from '../shared/handshake';
import { registerHealthCheckRoutes } from '../shared/healthcheck';
import { HSState, HSStorage } from '../shared/hs-storage';
import axios from 'axios';
import { IngressSources, registerIngressRoutes } from '../shared/ingress';

export const serverPort = 3000;
export const serverIp = 'https://capable-papers-rush-jake.trycloudflare.com';
// export const target = `https://8j1n18z7-3000.uks1.devtunnels.ms`;
export const target = `https://longest-hist-supporting-possession.trycloudflare.com`;


// ---------SERVER------------

const app: Express = express();
app.use(express.json());

app.get('/', (_req, res) => {
	res.send('Hello World! From 1');
});

let hsStorage = new HSStorage();
let ingressSources = new IngressSources();
registerHandShakeRoutes(app, hsStorage, serverIp);
registerHealthCheckRoutes(app, hsStorage);
registerIngressRoutes(app, hsStorage, ingressSources);


console.info(`Server is running on port ${serverPort}`);
app.listen(serverPort);

const healthCheckWorker = new Worker(
	new URL('../shared/healthcheck-worker.ts', import.meta.url).href
);
healthCheckWorker.onmessage = (event: MessageEvent<{ peerOrigin: string; healthy: boolean }>) => {
	if (!event.data.healthy) {
		hsStorage.closeHandshake(event.data.peerOrigin);
	}
};
healthCheckWorker.onerror = (event) => {
	console.error("Health-check worker failed:", event.message);
};

setInterval(() => {
	healthCheckWorker.postMessage(
		hsStorage.getConnections()
			.filter((connection) => connection.getState() === HSState.ACK)
			.map((connection) => connection.toUrl())
	);
}, 20_000);
