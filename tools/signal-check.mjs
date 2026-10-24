/**
 * 直接打线上环境，验证房间能把 relay-* 消息转发给对方，以及 /api/drop 能建分享页。
 */
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const WS = BASE.replace('http', 'ws');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const open = (url) => {
  const ws = new WebSocket(url);
  ws.inbox = [];
  ws.addEventListener('message', (ev) => ws.inbox.push(JSON.parse(ev.data)));
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error('ws error')));
    setTimeout(() => reject(new Error('ws timeout')), 8000);
  });
};

const { code } = await fetch(`${BASE}/api/room`, { method: 'POST' }).then((r) => r.json());
console.log(`  · 房间 ${code}`);

const sender = await open(`${WS}/ws?code=${code}&role=sender`);
const receiver = await open(`${WS}/ws?code=${code}&role=receiver`);
await wait(300);
sender.inbox.length = 0;
receiver.inbox.length = 0;

for (const t of ['relay-request', 'relay-progress', 'relay-file', 'relay-error']) {
  sender.send(JSON.stringify({ t, done: 1, total: 2 }));
  await wait(200);
  const got = receiver.inbox.find((m) => m.t === t);
  console.log(`  ${got ? 'ok  ' : 'FAIL'} ${t} 转发`);
  assert.ok(got, `${t} 没被转发`);
}

// 反向：接收方 → 发送方
receiver.send(JSON.stringify({ t: 'relay-request' }));
await wait(200);
assert.ok(sender.inbox.some((m) => m.t === 'relay-request'), 'relay-request 没到发送方');
console.log('  ok   relay-request 反向转发');

// 分享页
const drop = await fetch(`${BASE}/api/drop`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ files: [{ name: 'x.bin', size: 1, key: 'r/deadbeef/x.bin' }] }),
});
const dropBody = await drop.text();
console.log(`  · POST /api/drop → ${drop.status} ${dropBody.slice(0, 120)}`);
assert.equal(drop.status, 200, '分享页创建失败');

sender.close();
receiver.close();
console.log('\n信令与分享页检查通过');
process.exit(0);
