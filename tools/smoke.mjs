/**
 * 用 Node 自带的 WebSocket 客户端，验证本地垫片起的信令通道是真的能跑：
 * 建房 → 两人上线 → 消息只到对方。
 */
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const WS = BASE.replace('http', 'ws');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function open(url) {
  const ws = new WebSocket(url);
  ws.inbox = [];
  ws.addEventListener('message', (ev) => ws.inbox.push(JSON.parse(ev.data)));
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', (e) => reject(new Error(`ws error: ${e.message || e.type}`)));
    setTimeout(() => reject(new Error('ws open timeout')), 5000);
  });
}

const res = await fetch(`${BASE}/api/room`, { method: 'POST' });
assert.equal(res.status, 200);
const { code } = await res.json();
assert.match(code, /^[2-9A-HJ-NP-Z]{6}$/);
console.log(`  · 建房 ${code}`);

const sender = await open(`${WS}/ws?code=${code}&role=sender`);
const receiver = await open(`${WS}/ws?code=${code}&role=receiver`);
await wait(150);

assert.ok(sender.inbox.some((m) => m.t === 'peers' && m.n === 2), '发送方没收到 peers=2');
assert.ok(
  sender.inbox.some((m) => m.t === 'peer-joined' && m.role === 'receiver'),
  '发送方没收到对方上线通知',
);
console.log('  · 双人上线通知正常');

sender.inbox.length = 0;
receiver.inbox.length = 0;

sender.send(JSON.stringify({ t: 'offer', sdp: 'v=0 fake', from: 'receiver' }));
await wait(150);

assert.equal(receiver.inbox.length, 1, '接收方应收到 1 条');
assert.equal(receiver.inbox[0].t, 'offer');
assert.equal(receiver.inbox[0].from, 'sender', '服务端应覆盖伪造的身份');
assert.equal(sender.inbox.length, 0, '不应回显');
console.log('  · 信令转发与身份覆盖正常');

receiver.close();
await wait(150);
assert.ok(
  sender.inbox.some((m) => m.t === 'peer-left'),
  '发送方没收到对方离开',
);
console.log('  · 断开通知正常');

sender.close();
console.log('\n垫片信令通道通过');
process.exit(0);
