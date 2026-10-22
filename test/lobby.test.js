import assert from 'node:assert/strict';
import { Lobby } from '../src/lobby.js';

/* ---------- 最小化的 Durable Object 替身 ---------- */

class FakeResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.headers = init.headers ?? {};
  }
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  async json() {
    return JSON.parse(this.body);
  }
}
globalThis.Response = FakeResponse;

class FakeCtx {
  constructor() {
    this.map = new Map();
    this.alarmAt = 0;
    this.storage = {
      get: async (key) => this.map.get(key),
      put: async (key, value) => this.map.set(key, value),
      delete: async (key) => this.map.delete(key),
      deleteAll: async () => this.map.clear(),
      setAlarm: async (at) => {
        this.alarmAt = at;
      },
    };
  }
}

const newLobby = () => {
  const ctx = new FakeCtx();
  return { ctx, lobby: new Lobby(ctx, {}) };
};

const req = (path, method = 'GET', body = null) => ({
  url: `https://lobby.internal${path}`,
  method,
  json: async () => body || {},
});

const register = (lobby, code, name = '蓝色的海豚', platform = 'Windows · Edge') =>
  lobby.fetch(req('/register', 'POST', { code, name, platform }));

const list = (lobby, exclude = '') =>
  lobby.fetch(req(`/list${exclude ? `?exclude=${exclude}` : ''}`));

const invite = (lobby, id) => lobby.fetch(req('/invite', 'POST', { id }));
const redeem = (lobby, token) => lobby.fetch(req(`/invite/${token}`));

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

await test('登记后能在大厅列表里看到，且不暴露取件码', async () => {
  const { lobby } = newLobby();
  await register(lobby, 'ABC234');

  const res = await list(lobby);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rooms.length, 1);
  assert.equal(body.rooms[0].name, '蓝色的海豚');
  assert.ok(body.rooms[0].id, '应该给一个句柄 id');
  assert.equal(typeof body.rooms[0].age, 'number');

  // 取件码不能出现在响应里
  assert.ok(!JSON.stringify(body).includes('ABC234'), '列表不能带取件码');
  assert.equal(body.rooms[0].platform, 'Windows · Edge');
  assert.deepEqual(Object.keys(body.rooms[0]).sort(), ['age', 'id', 'name', 'platform']);
});

await test('同一个码重复登记只保留一条，id 不变', async () => {
  const { lobby } = newLobby();
  const first = await (await register(lobby, 'ABC234')).json();
  const second = await (await register(lobby, 'ABC234', '安静的水獭', 'iPhone · Safari')).json();

  assert.equal(first.id, second.id, '重复登记应该复用同一条');
  const body = await (await list(lobby)).json();
  assert.equal(body.rooms.length, 1);
  assert.equal(body.rooms[0].name, '安静的水獭', '名字应该更新');
});

await test('exclude 过滤掉自己', async () => {
  const { lobby } = newLobby();
  await register(lobby, 'ABC234');
  await register(lobby, 'XYZ789');

  const mine = await (await list(lobby, 'ABC234')).json();
  assert.deepEqual(
    mine.rooms.map((r) => r.name),
    ['蓝色的海豚'],
  );
  assert.equal((await (await list(lobby)).json()).rooms.length, 2);
});

await test('超过 3 分钟没人续期就自动消失', async () => {
  const { ctx, lobby } = newLobby();
  await register(lobby, 'ABC234');

  // 把时间戳拨旧
  const rooms = ctx.map.get('rooms');
  rooms[0].ts = Date.now() - 4 * 60 * 1000;
  ctx.map.set('rooms', rooms);

  const body = await (await list(lobby)).json();
  assert.deepEqual(body.rooms, [], '过期条目应该被清掉');
  assert.equal(ctx.map.get('rooms'), undefined, '存储也一起清');
});

await test('列表最多 20 条', async () => {
  const { lobby } = newLobby();
  const alpha = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 32 个合法字符
  const makeCode = (i) => {
    let n = i;
    let out = '';
    for (let k = 0; k < 6; k += 1) {
      out += alpha[n % alpha.length];
      n = Math.floor(n / alpha.length);
    }
    return out;
  };

  for (let i = 0; i < 25; i += 1) await register(lobby, makeCode(i));

  const body = await (await list(lobby)).json();
  assert.equal(body.rooms.length, 20, `列表应该封顶 20，实际 ${body.rooms.length}`);
});

await test('invite 只能换一次码，且换回来的是登记的那个码', async () => {
  const { lobby } = newLobby();
  const { id } = await (await register(lobby, 'ABC234')).json();

  const created = await invite(lobby, id);
  assert.equal(created.status, 200);
  const { token } = await created.json();
  assert.match(token, /^[2-9A-HJ-NP-Z]{12}$/);

  const first = await redeem(lobby, token);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { code: 'ABC234' });

  const twice = await redeem(lobby, token);
  assert.equal(twice.status, 404, '一次性邀请不能重复用');
});

await test('不存在的 id / 过期的 invite 都换不到码', async () => {
  const { ctx, lobby } = newLobby();
  assert.equal((await invite(lobby, 'AAAABBBB')).status, 404);

  const { id } = await (await register(lobby, 'ABC234')).json();
  const { token } = await (await invite(lobby, id)).json();

  // 把邀请时间拨旧
  const invites = ctx.map.get('invites');
  invites[token].ts = Date.now() - 2 * 60 * 1000;
  ctx.map.set('invites', invites);

  assert.equal((await redeem(lobby, token)).status, 404, '60 秒后就该失效');
});

await test('hide 之后立刻从列表消失', async () => {
  const { lobby } = newLobby();
  await register(lobby, 'ABC234');
  await lobby.fetch(req('/hide', 'POST', { code: 'abc234' }));

  assert.deepEqual((await (await list(lobby)).json()).rooms, []);
});

await test('取件码格式不对直接拒绝', async () => {
  const { lobby } = newLobby();
  assert.equal((await register(lobby, 'nope')).status, 400);
  assert.equal((await register(lobby, 'ABC01O')).status, 400, '0/1/O/I 不该通过');
  assert.equal((await lobby.fetch(req('/hide', 'POST', { code: 'x' }))).status, 400);
});

await test('alarm 清空过期数据，再登记还能用', async () => {
  const { ctx, lobby } = newLobby();
  await register(lobby, 'ABC234');
  assert.ok(ctx.alarmAt > Date.now(), '登记后应该设一个 alarm');

  // 手动把时间拨旧，再触发 alarm
  const rooms = ctx.map.get('rooms');
  rooms[0].ts = Date.now() - 11 * 60 * 1000;
  ctx.map.set('rooms', rooms);
  await lobby.alarm();
  assert.equal(ctx.map.size, 0, '过期后 alarm 应该清空存储');

  await register(lobby, 'ABC234');
  assert.equal((await (await list(lobby)).json()).rooms.length, 1);
});

console.log(lines.join('\n'));
console.log(process.exitCode ? '\n有失败用例' : '\n全部通过');
