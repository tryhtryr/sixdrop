import { Room } from './room.js';
import { Drop } from './drop.js';
import { Lobby } from './lobby.js';
import { handleRelay, presignGet, deleteObject } from './relay.js';

export { Room, Drop, Lobby };

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

    // 同网发现：按出口 IP 分组的大厅
    if (url.pathname === '/api/lobby') {
      if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
      return listLobby(request, env, url);
    }
    if (url.pathname === '/api/lobby/register' && request.method === 'POST') {
      return registerLobby(request, env);
    }
    if (url.pathname === '/api/lobby/hide' && request.method === 'POST') {
      return hideLobby(request, env);
    }
    if (url.pathname === '/api/lobby/invite' && request.method === 'POST') {
      return createInvite(request, env);
    }
    if (url.pathname.startsWith('/api/invite/') && request.method === 'GET') {
      return redeemInvite(request, env, url);
    }

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

/* ---------------- 同网发现（大厅） ---------------- */

// 加了盐的哈希当 DO 名：既能分组，又不把 IP 写进存储/日志
const SUBNET_SALT = 'sixdrop-lobby-v1';
const INVITE_RE = /^[2-9A-HJ-NP-Z]{12}$/;

/** IPv6 抹到 /64：同一个 Wi-Fi 下每台设备地址不同，只有前缀一样 */
function ipv6Prefix64(addr) {
  const head = String(addr).split('%')[0].toLowerCase();
  const [leftRaw = '', rightRaw = ''] = head.split('::');
  const left = leftRaw ? leftRaw.split(':') : [];
  const right = rightRaw ? rightRaw.split(':') : [];
  const missing = Math.max(0, 8 - left.length - right.length);
  const full = [...left, ...Array(missing).fill('0'), ...right];
  return full
    .slice(0, 4)
    .map((h) => (h || '0').padStart(4, '0'))
    .join(':');
}

async function subnetKey(request, env) {
  const raw = String(
    request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for') ||
      'dev', // 本地 dev-server 没有这个头：本机所有页面归到同一组
  )
    .split(',')[0]
    .trim();

  const group = raw.includes(':') ? `v6:${ipv6Prefix64(raw)}` : `v4:${raw}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${env.SUBNET_SALT || SUBNET_SALT}|${group}`),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

async function lobbyOf(request, env) {
  const key = await subnetKey(request, env);
  return env.LOBBY.get(env.LOBBY.idFromName(key));
}

async function listLobby(request, env, url) {
  const exclude = (url.searchParams.get('exclude') || '').toUpperCase();
  const stub = await lobbyOf(request, env);
  const qs = exclude ? `?exclude=${encodeURIComponent(exclude)}` : '';
  return stub.fetch(`https://lobby.internal/list${qs}`);
}

async function registerLobby(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  const code = String(body.code || '').toUpperCase();
  if (!CODE_RE.test(code)) return json({ error: 'bad code' }, 400);

  // 房间已经不在了就别登记，免得列表里出现进不去的房间
  const room = env.ROOMS.get(env.ROOMS.idFromName(code));
  const alive = await room.fetch('https://room.internal/exists');
  if (!alive.ok) return json({ error: 'no such room' }, 404);

  const stub = await lobbyOf(request, env);
  return stub.fetch('https://lobby.internal/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, device: String(body.device || '') }),
  });
}

async function hideLobby(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  const code = String(body.code || '').toUpperCase();
  if (!CODE_RE.test(code)) return json({ error: 'bad code' }, 400);

  const stub = await lobbyOf(request, env);
  return stub.fetch('https://lobby.internal/hide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

async function createInvite(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  const id = String(body.id || '');
  if (!/^[2-9A-HJ-NP-Z]{8}$/.test(id)) return json({ error: 'bad id' }, 400);

  const stub = await lobbyOf(request, env);
  return stub.fetch('https://lobby.internal/invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

async function redeemInvite(request, env, url) {
  const token = url.pathname.slice('/api/invite/'.length).toUpperCase();
  if (!INVITE_RE.test(token)) return json({ error: 'bad invite' }, 400);

  const stub = await lobbyOf(request, env);
  return stub.fetch(`https://lobby.internal/invite/${token}`);
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
