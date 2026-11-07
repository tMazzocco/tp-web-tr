import axios from 'axios';
import { sleep } from 'bun';

const A = 'http://localhost:3000';
const B = 'http://localhost:3001';

const http = axios.create({ validateStatus: () => true });

process.env.NODE_ID = 'Alice';
process.env.PORT = '3001';
await import('./app.ts');
await sleep(500);

// Alice => Theo
const r0 = await http.post(`${B}/broker/syn/Theo`, {}, { headers: { Origin: A } });
console.info('connect', r0.status, r0.data);
await sleep(2_000);

const r1 = await http.post(`${B}/broker/send/Theo`, { payload: { text: 'hello Theo' } });
console.info('Alice -> Theo', r1.status, r1.data);

const r2 = await http.post(`${A}/broker/send/Alice`, { payload: { text: 'hello Alice' } });
console.info('Theo -> Alice', r2.status, r2.data);

const r3 = await http.post(`${B}/broker/send/Theo`, { action: '/admin/password', payload: {} });
console.info('bad topic', r3.status, r3.data);

console.info('Theo peers', (await http.get(`${A}/broker/peers`)).data);
console.info('Alice peers', (await http.get(`${B}/broker/peers`)).data);

await sleep(1_000);
process.exit(0);
