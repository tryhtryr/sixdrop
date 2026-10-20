import { Room } from './room.js';
import { Drop } from './drop.js';
import { handleRelay, presignGet, deleteObject } from './relay.js';

export { Room, Drop };

const ROOM_TTL_MS = 30 * 60 * 1000;
// 去掉容易看错的 0/O/1/I，32 个字符，6 位约 10.7 亿种组合
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_RE = /^[2-9A-HJ-NP-Z]{6}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/room') {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      return createRoom(env);
    }

    if (url.pathname === '/ws') return openSocket(request, env, url);

    // 兜底中转：打洞失败时把文件直传 R2，收件人走预签名链接下载
    if (url.pathname.startsWith('/api/relay/')) return handleRelay(request, env, url);

    // 中转完成后的分享页：/d/<token>
    if (url.pathname === '/api/drop' && request.method === 'POST') {
      return createDrop(request, env);
    }
    if (url.pathname.startsWith('/api/drop/')) {
      if (url.pathname === '/api/drop/delete' && request.method === 'POST') {
        return deleteDrop(request, env);
      }
      return getDrop(env, url);
    }

    if (url.pathname.startsWith('/d/')) {
      // 用 '/' 而不是 '/index.html'：Assets 会把 /index.html 301 到 /，路径就丢了
      const page = await env.ASSETS.fetch(new Request(new URL('/', url.origin), request));
      const out = new Response(page.body, page);
      // 分享页是一次性的，别让搜索引擎收录
      out.headers.set('x-robots-tag', 'noindex, nofollow');
      return out;
    }

    // 其余全部交给静态资源（命中静态文件不计 Worker 请求，也不消耗额度）
    return env.ASSETS.fetch(request);
  },
};

async function createRoom(env) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = makeCode();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const res = await stub.fetch('https://room.internal/claim', { method: 'POST' });
    if (res.ok) return json({ code, expiresIn: ROOM_TTL_MS / 1000 });
  }
  return json({ error: 'busy' }, 503);
}

async function openSocket(request, env, url) {
  const code = (url.searchParams.get('code') || '').toUpperCase();
  const role = url.searchParams.get('role');

  if (!CODE_RE.test(code)) return json({ error: 'bad code' }, 400);
  if (role !== 'sender' && role !== 'receiver') return json({ error: 'bad role' }, 400);
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
    return json({ error: 'expected websocket' }, 426);
  }

  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  return stub.fetch(request);
}

/* ---------------- 中转完成后的分享页 ---------------- */

const DROP_TOKEN_RE = /^[2-9A-HJ-NP-Z]{10}$/;

function makeDropToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

async function createDrop(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  const files = (body.files || []).filter((f) => f && f.key && f.name);
  if (!files.length) return json({ error: 'no files' }, 400);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const token = makeDropToken();
    const stub = env.DROPS.get(env.DROPS.idFromName(token));
    const res = await stub.fetch('https://drop.internal/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files }),
    });

    if (res.ok) {
      const origin = new URL(request.url).origin;
      return json({ token, url: `${origin}/d/${token}`, expiresIn: 86400 });
    }
  }

  return json({ error: 'busy' }, 503);
}

async function deleteDrop(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  const token = String(body.token || '');
  if (!DROP_TOKEN_RE.test(token)) return json({ error: 'bad token' }, 400);

  const stub = env.DROPS.get(env.DROPS.idFromName(token));
  const res = await stub.fetch('https://drop.internal/get');

  // 已经过期或删过了，也算成功
  if (!res.ok) return json({ ok: true, deleted: 0 });

  const data = await res.json();
  let deleted = 0;

  for (const file of data.files || []) {
    try {
      if (await deleteObject(env, file.key)) deleted += 1;
    } catch {
      /* 单个失败不影响其它 */
    }
  }

  await stub.fetch('https://drop.internal/del', { method: 'POST' });
  return json({ ok: true, deleted });
}

async function getDrop(env, url) {
  const token = url.pathname.slice('/api/drop/'.length);
  if (!DROP_TOKEN_RE.test(token)) return json({ error: 'bad token' }, 400);

  const stub = env.DROPS.get(env.DROPS.idFromName(token));
  const res = await stub.fetch('https://drop.internal/get');
  if (!res.ok) return json({ error: 'not found' }, 404);

  const data = await res.json();
  try {
    const files = [];
    for (const file of data.files) {
      files.push({ name: file.name, size: file.size, url: await presignGet(env, file.key) });
    }
    return json({ files });
  } catch (err) {
    return json({ error: err?.message || 'sign failed' }, 503);
  }
}
