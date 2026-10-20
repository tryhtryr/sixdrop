import assert from 'node:assert/strict';
import { Room } from '../src/room.js';

/* ---------- 最小化的 Workers 运行时替身 ---------- */

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.closed = false;
    this.sent = [];
    this.att = null;
  }
  send(data) {
    if (this.closed) throw new Error('socket closed');
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  serializeAttachment(value) {
    this.att = value;
  }
  deserializeAttachment() {
    return this.att;
  }
  clear() {
    this.sent.length = 0;
  }
  types() {
    return this.sent.map((m) => m.t);
  }
}

class FakePair {
  constructor() {
    this[0] = new FakeSocket();
    this[1] = new FakeSocket();
  }
}

globalThis.WebSocketPair = FakePair;

class FakeResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.webSocket = init.webSocket;
  }
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
}
globalThis.Response = FakeResponse;

class FakeCtx {
  constructor() {
    this.map = new Map();
    this.sockets = [];
    this.alarmAt = 0;
    this.storage = {
      get: async (key) => this.map.get(key),
      put: async (key, value) => this.map.set(key, value),
      deleteAll: async () => this.map.clear(),
      setAlarm: async (at) => {
        this.alarmAt = at;
      },
    };
  }
  acceptWebSocket(ws) {
    this.sockets.push(ws);
  }
  getWebSockets() {
    return this.sockets.filter((ws) => !ws.closed);
  }
}

async function newRoom() {
  const ctx = new FakeCtx();
  const room = new Room(ctx, {});
  await room.fetch({ url: 'https://room.internal/claim', method: 'POST' });
  return { ctx, room };
}

const claim = (room) => room.fetch({ url: 'https://room.internal/claim', method: 'POST' });

async function open(room, role) {
  const res = await room.fetch({ url: `https://room.internal/ws?role=${role}`, method: 'GET' });
  // 服务端那一半才会收到 DO 的 send()
  const server = room.ctx.sockets[room.ctx.sockets.length - 1];
  return { status: res.status, server, client: res.webSocket };
}

/* ---------- 用例 ---------- */

const lines = [];
async function test(name, fn) {
  try {
    await fn();
    lines.push(`  ok   ${name}`);
  } catch (err) {
    lines.push(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

await test('未创建的房间直接 404', async () => {
  const room = new Room(new FakeCtx(), {});
  const res = await open(room, 'sender');
  assert.equal(res.status, 404);
});

await test('claim 一次成功、第二次 409，并设置过期 alarm', async () => {
  const ctx = new FakeCtx();
  const room = new Room(ctx, {});

  assert.equal((await claim(room)).status, 200);
  assert.equal((await claim(room)).status, 409);
  assert.ok(ctx.alarmAt > Date.now(), 'alarm 应该在将来');
});

await test('两人进入后互相知道对方在线', async () => {
  const { room } = await newRoom();

  const sender = await open(room, 'sender');
  assert.equal(sender.status, 101);
  assert.deepEqual(sender.server.sent[0], { t: 'joined', role: 'sender' });
  assert.deepEqual(sender.server.sent.at(-1), { t: 'peers', n: 1 });

  const receiver = await open(room, 'receiver');
  assert.deepEqual(sender.server.sent.at(-1), { t: 'peers', n: 2 });
  assert.ok(sender.server.sent.some((m) => m.t === 'peer-joined' && m.role === 'receiver'));
  assert.deepEqual(receiver.server.sent.at(-1), { t: 'peers', n: 2 });
});

await test('信令只转发给对方，且身份由服务端标注', async () => {
  const { room } = await newRoom();
  const sender = await open(room, 'sender');
  const receiver = await open(room, 'receiver');

  sender.server.clear();
  receiver.server.clear();

  // 接收方发 answer，客户端伪造 from: 'sender'
  await room.webSocketMessage(
    receiver.server,
    JSON.stringify({ t: 'answer', sdp: 'v=0 fake', from: 'sender' }),
  );

  assert.equal(sender.server.sent.length, 1);
  assert.equal(sender.server.sent[0].t, 'answer');
  assert.equal(sender.server.sent[0].from, 'receiver', '服务端必须覆盖客户端自称的身份');
  assert.equal(receiver.server.sent.length, 0, '不应回显给发起方');
});

await test('白名单之外的消息一律丢弃', async () => {
  const { room } = await newRoom();
  const sender = await open(room, 'sender');
  const receiver = await open(room, 'receiver');
  receiver.server.clear();

  await room.webSocketMessage(sender.server, JSON.stringify({ t: 'file', data: 'x' }));
  await room.webSocketMessage(sender.server, 'not json');
  await room.webSocketMessage(sender.server, 'x'.repeat(70 * 1024));

  assert.equal(receiver.server.sent.length, 0);
});

await test('同角色重连：旧的静默顶替，不打扰对端', async () => {
  const { room } = await newRoom();
  const oldSender = await open(room, 'sender');
  const receiver = await open(room, 'receiver');
  receiver.server.clear();

  const newSender = await open(room, 'sender');

  assert.equal(oldSender.server.closed, true, '旧连接应被关闭');
  assert.ok(!receiver.server.sent.some((m) => m.t === 'peer-left'), '不应通知对端有人离开');
  assert.deepEqual(newSender.server.sent.at(-1), { t: 'peers', n: 2 });

  // 旧连接随后补触发 close 回调，也不能再发 peer-left
  receiver.server.clear();
  await room.webSocketClose(oldSender.server);
  assert.equal(receiver.server.sent.length, 0);
});

await test('主动断开时通知对端', async () => {
  const { room } = await newRoom();
  const sender = await open(room, 'sender');
  const receiver = await open(room, 'receiver');

  sender.server.clear();
  receiver.server.closed = true; // 运行时会把已断开的 socket 移出列表
  await room.webSocketClose(receiver.server);

  const left = sender.server.sent.find((m) => m.t === 'peer-left');
  assert.ok(left, '发送方应收到 peer-left');
  assert.equal(left.from, 'receiver');
});

await test('还有人连着时 alarm 只顺延，不打断传输', async () => {
  const { room, ctx } = await newRoom();
  const sender = await open(room, 'sender');
  const before = ctx.alarmAt;

  await room.alarm();

  assert.equal(sender.server.closed, false, '不应踢掉正在使用的连接');
  assert.equal(ctx.map.size, 1, '存储不应被清空');
  // 同一毫秒内重排会得到相同时间戳，所以这里用 >=
  assert.ok(ctx.alarmAt >= before, `alarm 应被重新排期 (before=${before}, after=${ctx.alarmAt})`);
});

await test('没人连着时 alarm 清空存储，房间不可再进', async () => {
  const { room, ctx } = await newRoom();
  const sender = await open(room, 'sender');
  sender.server.closed = true; // 模拟页面已关闭

  await room.alarm();

  assert.equal(ctx.map.size, 0, '存储应被清空');

  const again = await open(room, 'sender');
  assert.equal(again.status, 404, '过期后不可再进');
});

console.log(lines.join('\n'));
console.log(process.exitCode ? '\n有失败用例' : '\n全部通过');
