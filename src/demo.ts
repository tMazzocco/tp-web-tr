import axios from 'axios';
import { sleep } from 'bun';

const A = 'http://localhost:3000';
const B = 'http://localhost:3001';



process.env.NODE_ID = 'Alice';
process.env.PORT = '3001';
await import('./app.ts');
await sleep(500);

// Alice => Theo
console.info('connect', axios.post(`${B}/broker/syn/Theo`, {}, { headers: { Origin: A } }));
sleep(2_000);

console.info('Alice -> Theo', axios.post(`${B}/broker/send/Theo`, { payload: { text: 'hello Theo' } }));
console.info('Theo -> Alice', axios.post(`${A}/broker/send/Alice`, { payload: { text: 'hello Alice' } }));
console.info('bad topic', axios.post(`${B}/broker/send/Theo`, { action: '/admin/password', payload: {} }));
console.info('Theo peers', axios.get(`${A}/broker/peers`));
console.info('Alice peers', axios.get(`${B}/broker/peers`));

await sleep(1_000);
process.exit(0);
