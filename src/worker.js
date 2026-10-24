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

/* ---------------- 静态页与 SEO 文件 ---------------- */

// 仓库里不写死域名：sitemap / robots / 页面里的 canonical 都用请求的 origin 生成
const SITE_PATHS = [
  ['/', '1.0', 'weekly'],
  ['/about', '0.8', 'monthly'],
  ['/guide', '0.8', 'monthly'],
  ['/guide/phone-to-pc', '0.7', 'monthly'],
  ['/guide/lan-large-files', '0.7', 'monthly'],
  ['/guide/no-cloud', '0.7', 'monthly'],
  ['/guide/webrtc-p2p', '0.7', 'monthly'],
  ['/guide/symmetric-nat', '0.7', 'monthly'],
];
const SITE_UPDATED = '2026-10-24';

function sitemap(url) {
  const rows = SITE_PATHS.map(
    ([path, priority, changefreq]) =>
      `  <url>\n    <loc>${url.origin}${path}</loc>\n    <lastmod>${SITE_UPDATED}</lastmod>\n` +
      `    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`,
  ).join('\n');

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</urlset>\n`,
    {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    },
  );
}

function robots(url) {
  const body =
    'User-agent: *\nAllow: /\n\n' +
    '# 分享页是一次性的，不该被收录\nDisallow: /d/\nDisallow: /api/\n\n' +
    `Sitemap: ${url.origin}/sitemap.xml\n`;
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}

/**
 * 取静态 HTML 并把 __ORIGIN__ 换成当前请求的 origin。
 * 这样 canonical / og:url / JSON-LD 在任何域名下都正确，仓库里不需要出现域名。
 */
async function serveHtml(env, request, url, assetPath, { noindex = false } = {}) {
  const res = await env.ASSETS.fetch(new Request(new URL(assetPath, url.origin), request));
  const type = res.headers.get('content-type') || '';
  if (!type.includes('text/html')) return res;

  const text = (await res.text()).replaceAll('__ORIGIN__', url.origin);
  const headers = new Headers(res.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.delete('content-length');
  // 页面是 Worker 现渲染的（还要注入验证 meta），不要被边缘缓存住，
  // 否则刚部署的改动（比如站点验证标签）可能几分钟内都抓不到
  headers.set('cache-control', 'no-store');
  if (noindex) headers.set('x-robots-tag', 'noindex, nofollow');
  return new Response(text, { status: res.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 统一到一个 host + https：www 去掉，http 升 https（host 来自请求，不写死域名）
    const apex = url.hostname.replace(/^www\./, '');
    const isLocal =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]' ||
      /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname);
    if (!isLocal && (url.hostname !== apex || url.protocol === 'http:')) {
      return Response.redirect(new URL(url.pathname + url.search, `https://${apex}`).toString(), 301);
    }

    // sitemap / robots 按请求域名生成，仓库里不写死域名
    if (url.pathname === '/sitemap.xml') return sitemap(url);
    if (url.pathname === '/robots.txt') return robots(url);

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

    // 网络诊断：只回一个短哈希和地址族，两台设备比一下就知道是不是同一组
    if (url.pathname === '/api/lobby/whoami') {
      const ip = String(
        request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'dev',
      )
        .split(',')[0]
        .trim();
      const key = await subnetKey(request, env);
      return json({ tag: key.slice(0, 8), family: ip.includes(':') ? 'IPv6' : 'IPv4' });
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

    // 首页：Assets 关掉了自动 index 解析，这里显式指到 index.html
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return serveHtml(env, request, url, '/index.html');
    }

    if (url.pathname.startsWith('/d/')) {
      // 分享页是一次性的，别让搜索引擎收录
      return serveHtml(env, request, url, '/index.html', { noindex: true });
    }

    // 静态页面的好看 URL：/about → /about.html（避免 Assets 的目录重定向）
    if (url.pathname === '/about' || url.pathname === '/about/') {
      return serveHtml(env, request, url, '/about.html');
    }

    // 指南页：/guide → /guide/index.html；/guide/<slug> → /guide/<slug>.html
    if (url.pathname === '/guide' || url.pathname === '/guide/') {
      return serveHtml(env, request, url, '/guide/index.html');
    }
    if (url.pathname.startsWith('/guide/') && !url.pathname.endsWith('.html')) {
      const slug = url.pathname.slice('/guide/'.length).replace(/\/+$/, '');
      if (/^[a-z0-9-]{2,60}$/.test(slug)) {
        return serveHtml(env, request, url, `/guide/${slug}.html`);
      }
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

  // 把「这个房间属于哪个同网大厅」带上：房主断线时房间自己把大厅条目撤掉
  const forwardedUrl = new URL(request.url);
  forwardedUrl.searchParams.set('seat', await subnetKey(request, env));

  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  return stub.fetch(new Request(forwardedUrl, request));
}

/* ---------------- 同网发现（大厅） ---------------- */

// 加了盐的哈希当 DO 名：既能分组，又不把 IP 写进存储/日志
const SUBNET_SALT = 'sixdrop-lobby-v1';
// 大厅的接口契约一变就 +1：已活着的 DO 实例会继续跑旧代码，
// 换一个命名空间就等于换一批新实例，旧的自然过期。
const LOBBY_VERSION = 'v2';
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

/**
 * 大厅分组键：按出口 IP（IPv4 精确、IPv6 /64），加盐哈希当 DO 名。
 * 双 WAN 按连接分流时出口 IP 会变来变去，那种网络下自动发现不可靠，
 * 用取件码/分享链接最稳。
 */
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
    new TextEncoder().encode(`${env.SUBNET_SALT || SUBNET_SALT}|${LOBBY_VERSION}|${group}`),
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
  const res = await stub.fetch(`https://lobby.internal/list${qs}`);
  if (!res.ok) return res;

  // 兼容还在跑旧代码的 Lobby 实例：旧版本只有 device 字段
  const data = await res.json();
  const rooms = (data.rooms || []).map((room) => ({
    id: room.id,
    name: room.name || room.device || '未知设备',
    platform: room.platform || '',
    age: Number(room.age) || 0,
  }));
  return json({ rooms, tag: data.tag });
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
  const name = String(body.name || body.device || '');
  return stub.fetch('https://lobby.internal/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // device 是给「还没更新的 Lobby 实例」留的兼容字段
    body: JSON.stringify({ code, name, device: name, platform: String(body.platform || '') }),
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
  const res = await stub.fetch(`https://lobby.internal/invite/${token}`);
  if (!res.ok) return res;

  const { code } = await res.json();

  // 大厅条目会多活几分钟：换码之前先确认房主还在线
  const room = env.ROOMS.get(env.ROOMS.idFromName(code));
  const alive = await room.fetch('https://room.internal/alive');
  if (!alive.ok) {
    // 顺手把这条已经没人的登记从大厅里撤掉
    await stub
      .fetch('https://lobby.internal/hide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      .catch(() => {});
    return json({ error: 'host-left' }, 404);
  }

  return json({ code });
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
