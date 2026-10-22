/**
 * 同网大厅：一个「出口 IP 分组」一个实例，只记谁在等对方。
 *
 *  - 不存 IP、不存文件，只存 { id, code, device, ts }
 *  - 对外只给 id / 设备名 / 多久之前，取件码永远不出现
 *  - 想加入得先换一次性 invite，换到码才能连房间（房间那边还要房主审批）
 *  - 条目 3 分钟没人续期就当过期（前端在大厅里每 20 秒续一次），列表和 alarm 都会清
 */
const ENTRY_TTL_MS = 3 * 60 * 1000;
const INVITE_TTL_MS = 60 * 1000;
const MAX_ENTRIES = 20;
const MAX_INVITES = 40;
const DEVICE_MAX = 40;
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const CODE_RE = /^[2-9A-HJ-NP-Z]{6}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

function randomId(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

export class Lobby {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method || 'GET';

    try {
      if (url.pathname === '/register' && method === 'POST') return await this.register(request);
      if (url.pathname === '/hide' && method === 'POST') return await this.hide(request);
      if (url.pathname === '/list' && method === 'GET') return await this.list(url);
      if (url.pathname === '/invite' && method === 'POST') return await this.createInvite(request);
      if (url.pathname.startsWith('/invite/') && method === 'GET') {
        return await this.redeemInvite(url.pathname.slice('/invite/'.length));
      }
    } catch {
      return json({ error: 'bad request' }, 400);
    }

    return json({ error: 'not found' }, 404);
  }

  /* ---------------- 房间注册表 ---------------- */

  async rooms() {
    const all = (await this.ctx.storage.get('rooms')) || [];
    const now = Date.now();
    const live = all.filter((e) => e && now - e.ts < ENTRY_TTL_MS);
    if (live.length !== all.length) await this.save('rooms', live);
    return live;
  }

  async register(request) {
    const body = await request.json();
    const code = String(body.code || '').toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: 'bad code' }, 400);

    const device = String(body.device || '').slice(0, DEVICE_MAX) || '未知设备';
    const list = await this.rooms();
    const now = Date.now();

    let entry = list.find((e) => e.code === code);
    if (entry) {
      entry.device = device;
      entry.ts = now;
    } else {
      entry = { id: randomId(8), code, device, ts: now };
      list.push(entry);
    }

    // 只留最新的 20 条，防止同网刷列表
    list.sort((a, b) => a.ts - b.ts);
    const trimmed = list.slice(-MAX_ENTRIES);
    await this.save('rooms', trimmed);
    await this.arm();

    return json({ ok: true, id: entry.id });
  }

  async hide(request) {
    const body = await request.json();
    const code = String(body.code || '').toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: 'bad code' }, 400);

    const list = await this.rooms();
    const left = list.filter((e) => e.code !== code);
    if (left.length !== list.length) await this.save('rooms', left);
    return json({ ok: true });
  }

  async list(url) {
    const exclude = (url.searchParams.get('exclude') || '').toUpperCase();
    const now = Date.now();

    const rooms = (await this.rooms())
      .filter((e) => e.code !== exclude)
      .sort((a, b) => b.ts - a.ts)
      // 注意：不返回 code
      .map((e) => ({ id: e.id, device: e.device, age: Math.max(0, now - e.ts) }));

    return json({ rooms });
  }

  /* ---------------- 一次性 invite ---------------- */

  async createInvite(request) {
    const body = await request.json();
    const id = String(body.id || '');
    const entry = (await this.rooms()).find((e) => e.id === id);
    if (!entry) return json({ error: 'not found' }, 404);

    const invites = await this.liveInvites();
    const token = randomId(12);
    invites[token] = { code: entry.code, ts: Date.now() };

    // 只留最近的一批，防止被刷
    const keys = Object.keys(invites).sort((a, b) => invites[a].ts - invites[b].ts);
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_INVITES))) delete invites[key];

    await this.save('invites', invites);
    await this.arm();
    return json({ token, expiresIn: INVITE_TTL_MS / 1000 });
  }

  async redeemInvite(token) {
    const invites = await this.liveInvites();
    const found = invites[token];
    if (!found) return json({ error: 'expired' }, 404);

    // 一次性：换过就把票撕掉
    delete invites[token];
    await this.save('invites', invites);
    return json({ code: found.code });
  }

  async liveInvites() {
    const all = (await this.ctx.storage.get('invites')) || {};
    const now = Date.now();
    const live = {};
    let changed = false;
    for (const [token, v] of Object.entries(all)) {
      if (v && now - v.ts < INVITE_TTL_MS) live[token] = v;
      else changed = true;
    }
    if (changed) await this.save('invites', live);
    return live;
  }

  /* ---------------- 存取 / 过期 ---------------- */

  async save(key, value) {
    if (Array.isArray(value) && value.length === 0) {
      await this.ctx.storage.delete(key);
      return;
    }
    if (key === 'invites' && Object.keys(value).length === 0) {
      await this.ctx.storage.delete('invites');
      return;
    }
    await this.ctx.storage.put(key, value);
  }

  async arm() {
    const rooms = (await this.ctx.storage.get('rooms')) || [];
    const invites = (await this.ctx.storage.get('invites')) || {};
    const times = [
      ...rooms.map((e) => e.ts + ENTRY_TTL_MS),
      ...Object.values(invites).map((v) => v.ts + INVITE_TTL_MS),
    ].filter((t) => Number.isFinite(t));
    if (!times.length) return;
    await this.ctx.storage.setAlarm(Math.min(...times));
  }

  async alarm() {
    const rooms = await this.rooms();
    const invites = await this.liveInvites();
    if (rooms.length || Object.keys(invites).length) {
      await this.arm();
      return;
    }
    await this.ctx.storage.deleteAll();
  }
}
