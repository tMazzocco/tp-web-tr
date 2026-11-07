import express from 'express';
import { HsService, registerHandShakeRoutes } from '../shared/handshake.ts';
import { registerHealthCheckRoutes } from '../shared/healthcheck.ts';
import { HSStorage } from '../shared/hs-storage.ts';
import { IngressSources, registerIngressRoutes } from '../shared/ingress.ts';
import { startBrokerPileWorkerLoop, startHealthCheckLoop } from '../shared/background-loops.ts';
import { Broker, ClientRegistry, registerBrokerRoutes } from '../shared/broker.ts';
import { ToolsService } from '../shared/tools.ts';
import { Encryption } from '../shared/diffi/encrypter.ts';

const ID = process.env.NODE_ID ?? 'Theo';
const PORT = Number(process.env.PORT ?? 3000);
const URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;

const app = express();
app.use(express.json());
app.get('/', (_req, res) => { res.send(`Hello from ${ID}`); });

const hsService = new HsService(new HSStorage());
const registry = new ClientRegistry();
const encryption = new Encryption(registry);
const broker = new Broker(hsService, new ToolsService(), URL, ID, encryption, registry);

registerHandShakeRoutes(app, hsService, URL);
registerHealthCheckRoutes(app, hsService);
registerIngressRoutes(app, hsService, new IngressSources(), encryption, broker);
registerBrokerRoutes(app, broker);

app.listen(PORT, () => console.info(`[${ID}] up on ${URL}`));

const ct = new AbortController().signal;
startBrokerPileWorkerLoop(broker, 1_000, ct);
startHealthCheckLoop(hsService, 20_000, ct);
