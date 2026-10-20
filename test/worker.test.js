import assert from 'node:assert/strict';

class FakeResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.headers = new Headers(init.headers);
  }
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  async json() {
    return JSON.parse(this.body);
  }
}
globalThis.Response = FakeResponse;

const { default: worker } = await import('../src/worker.js');

const claimed = new Set();

const env = {
  ROOMS: {
    idFromName: (name) => name,
    get: (id) => ({
      fetch: async (url, init) => {
        if (String(url).endsWith('/claim') && init?.method === 'POST') {
          if (claimed.has(id)) return new FakeResponse('taken', { status: 409 });
          claimed.add(id);
          return new FakeResponse('ok');
        }
        return new FakeResponse('ws', { status: 101 });
      },
    }),
  },
  ASSETS: {
    fetch: async (request) => new FakeResponse(`asset:${new URL(request.url).pathname}`),
  },
};

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

await test('POST /api/room 发一个合法的 6 位取件码', async () => {
  const res = await worker.fetch(
    new Request('https://drop.example/api/room', { method: 'POST' }),
    env,
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.code, /^[2-9A-HJ-NP-Z]{6}$/);
  assert.equal(data.expiresIn, 1800);
});

await test('两个房间的码不重复', async () => {
  const codes = new Set();
  for (let i = 0; i < 20; i += 1) {
    const res = await worker.fetch(
      new Request('https://drop.example/api/room', { method: 'POST' }),
      env,
    );
    const { code } = await res.json();
    assert.ok(!codes.has(code), `重复取件码 ${code}`);
    codes.add(code);
  }
});

await test('GET /api/room 返回 405', async () => {
  const res = await worker.fetch(new Request('https://drop.example/api/room'), env);
  assert.equal(res.status, 405);
});

await test('/ws 没有 Upgrade 头返回 426', async () => {
  const res = await worker.fetch(new Request('https://drop.example/ws?code=ABCDEF&role=sender'), env);
  assert.equal(res.status, 426);
});

await test('/ws 取件码格式不对返回 400', async () => {
  const res = await worker.fetch(
    new Request('https://drop.example/ws?code=abc&role=sender', {
      headers: { Upgrade: 'websocket' },
    }),
    env,
  );
  assert.equal(res.status, 400);
});

await test('/ws 角色不对返回 400', async () => {
  const res = await worker.fetch(
    new Request('https://drop.example/ws?code=ABCDEF&role=hacker', {
      headers: { Upgrade: 'websocket' },
    }),
    env,
  );
  assert.equal(res.status, 400);
});

await test('其它路径落到静态资源', async () => {
  const res = await worker.fetch(new Request('https://drop.example/style.css'), env);
  assert.equal(res.body, 'asset:/style.css');
});

/* ---------- 分享页 ---------- */

const drops = new Map();
Object.assign(env, {
  R2_ACCOUNT_ID: 'acct',
  R2_BUCKET: 'bucket',
  R2_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  R2_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  DROPS: {
    idFromName: (name) => name,
    get: (id) => ({
      fetch: async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        if (String(url).endsWith('/init')) {
          drops.set(id, JSON.parse(init.body).files);
          return new FakeResponse(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (!drops.has(id)) return new FakeResponse(JSON.stringify({ error: 'nf' }), { status: 404 });
        return new FakeResponse(JSON.stringify({ files: drops.get(id) }), { status: 200 });
      },
    }),
  },
});

await test('中转分享页：创建后能取回清单和预签名链接', async () => {
  const created = await worker.fetch(
    new Request('https://sixdrop.dev/api/drop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: [{ name: 'a.bin', size: 10, key: 'r/uuid/a.bin' }] }),
    }),
    env,
  );

  assert.equal(created.status, 200);
  const data = await created.json();
  assert.match(data.token, /^[2-9A-HJ-NP-Z]{10}$/);
  assert.equal(data.url, `https://sixdrop.dev/d/${data.token}`);

  const got = await worker.fetch(new Request(`https://sixdrop.dev/api/drop/${data.token}`), env);
  assert.equal(got.status, 200);
  const list = await got.json();
  assert.equal(list.files.length, 1);
  assert.equal(list.files[0].name, 'a.bin');
  assert.match(list.files[0].url, /X-Amz-Signature=/);
});

await test('分享页：没有文件拒收、token 格式不对拒收', async () => {
  const empty = await worker.fetch(
    new Request('https://sixdrop.dev/api/drop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: [] }),
    }),
    env,
  );
  assert.equal(empty.status, 400);

  const bad = await worker.fetch(new Request('https://sixdrop.dev/api/drop/nope!'), env);
  assert.equal(bad.status, 400);

  const missing = await worker.fetch(new Request('https://sixdrop.dev/api/drop/23456789AB'), env);
  assert.equal(missing.status, 404);
});

console.log(lines.join('\n'));
console.log(process.exitCode ? '\n有失败用例' : '\n全部通过');
