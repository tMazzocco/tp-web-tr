import express, { type Express } from 'express';
import { registerHandShakeRoutes } from "../shared/handshake.ts";
import { registerHealthCheckRoutes } from '../shared/healthcheck';

import { HSStorage } from '../shared/hs-storage.ts';
import { IngressSources, registerIngressRoutes } from '../shared/ingress.ts';

const serverPort = 3001;
const serverIp = 'https://practical-housewives-foo-formed.trycloudflare.com';

const app: Express = express();
app.get('/', (_req, res) => {
	res.send('Hello World! From 2');
});
app.use(express.json());

let hsStorage = new HSStorage();
let ingressSources = new IngressSources();
registerHandShakeRoutes(app, hsStorage, serverIp);
registerHealthCheckRoutes(app, hsStorage);
registerIngressRoutes(app, hsStorage, ingressSources);

console.info(`Server is running on port ${serverPort}`);
app.listen(serverPort);
    