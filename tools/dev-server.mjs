/**
 * 本地运行时垫片：把 Cloudflare Workers 需要的那几个全局对象用 Node 模拟出来，
 * 这样不用装 wrangler 也能跑真实的 src/worker.js + src/room.js。
 *
 * 只用于本地开发和浏览器端到端测试，不要拿它上线。
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC_DIR = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);

/* ---------------- Workers 全局垫片 ---------------- */

class ShimResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.headers = init.headers ?? {};
    this.webSocket = init.webSocket ?? null;
  }
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  async json() {
    return JSON.parse(this.body);
  }
  async text() {
    return String(this.body ?? '');
  }
}

globalThis.Response = ShimResponse;

class ShimSocket {
  constructor() {
    this.att = null;
    this.closed = false;
    this.net = null;
    this.queue = [];
  }
  serializeAttachment(value) {
    this.att = value;
  }
  deserializeAttachment() {
    return this.att;
  }
  send(data) {
    if (this.closed) throw new Error('socket closed');
    if (!this.net) {
      this.queue.push(data);
      return;
    }
    writeFrame(this.net, 0x1, Buffer.from(String(data), 'utf8'));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.net) {
      try {
        writeFrame(this.net, 0x8, Buffer.alloc(0));
        this.net.end();
      } catch {
        /* 忽略 */
      }
    }
  }
  bind(net) {
    this.net = net;
    for (const item of this.queue.splice(0)) this.send(item);
  }
}

class ShimPair {
  constructor() {
    this[0] = new ShimSocket(); // client，本垫片不使用
    this[1] = new ShimSocket(); // server，交给 acceptWebSocket
  }
}

globalThis.WebSocketPair = ShimPair;

const makeRequest = (url, method, headers) => ({ url, method, headers: new Headers(headers) });

/* ---------------- WebSocket 帧编解码 ---------------- */

function writeFrame(socket, opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  socket.write(Buffer.concat([header, payload]));
}

function readFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + len) return null;

  let payload = Buffer.from(buf.subarray(offset + maskLen, offset + maskLen + len));
  if (masked) {
    const mask = buf.subarray(offset, offset + maskLen);
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3];
  }

  return { opcode, payload, total: offset + maskLen + len };
}

function handshake(req, socket) {
  const key = req.headers['sec-websocket-key'];
  const accept = createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
}

/* ---------------- 房间注册表 ---------------- */

const rooms = new Map();

function getRoom(code) {
  let entry = rooms.get(code);
  if (!entry) {
    const ctx = createCtx(code);
    // env 在文件后面才定义，这里拿的是同一个对象（请求发生时早已初始化）
    entry = { ctx, room: new Room(ctx, env) };
    rooms.set(code, entry);
  }
  return entry;
}

let pendingAccept = null;

function createCtx(code) {
  const data = new Map();
  const sockets = [];

  return {
    storage: {
      get: async (key) => data.get(key),
      put: async (key, value) => {
        data.set(key, value);
      },
      deleteAll: async () => data.clear(),
      setAlarm: async (at) => {
        const timer = setTimeout(
          () => {
            rooms.get(code)?.room.alarm().catch(() => {});
          },
          Math.max(0, at - Date.now()),
        );
        if (timer.unref) timer.unref();
      },
    },
    acceptWebSocket(ws) {
      sockets.push(ws);
      if (pendingAccept) pendingAccept(ws);
    },
    getWebSockets() {
      return sockets.filter((ws) => !ws.closed);
    },
  };
}

/* ---------------- 载入业务代码 ---------------- */

const { default: worker } = await import('../src/worker.js');
const { Room } = await import('../src/room.js');
const { Drop } = await import('../src/drop.js');
const { Lobby } = await import('../src/lobby.js');

const drops = new Map();

function getDropEntry(id) {
  let entry = drops.get(id);
  if (!entry) {
    const data = new Map();
    const ctx = {
      storage: {
        get: async (key) => data.get(key),
        put: async (key, value) => data.set(key, value),
        delete: async (key) => data.delete(key),
        deleteAll: async () => data.clear(),
        setAlarm: async () => {},
      },
    };
    entry = { drop: new Drop(ctx, {}) };
    drops.set(id, entry);
  }
  return entry;
}

const lobbies = new Map();

function getLobbyEntry(id) {
  let entry = lobbies.get(id);
  if (!entry) {
    const data = new Map();
    const ctx = {
      storage: {
        get: async (key) => data.get(key),
        put: async (key, value) => data.set(key, value),
        delete: async (key) => data.delete(key),
        deleteAll: async () => data.clear(),
        setAlarm: async () => {},
      },
    };
    entry = { lobby: new Lobby(ctx, {}) };
    lobbies.set(id, entry);
  }
  return entry;
}

const env = {
  ROOMS: {
    idFromName: (name) => name,
    get: (id) => ({
      // worker 里既有 stub.fetch(url, init) 也有 stub.fetch(request) 两种调用
      fetch: (input) => {
        const request = typeof input === 'string' ? { url: input, method: 'GET' } : input;
        return getRoom(id).room.fetch(request);
      },
    }),
  },
  DROPS: {
    idFromName: (name) => name,
    get: (id) => ({
      fetch: async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        const body = init.body ?? null;
        return getDropEntry(id).drop.fetch({
          url,
          method: init.method || 'GET',
          json: async () => JSON.parse(body || '{}'),
        });
      },
    }),
  },
  LOBBY: {
    idFromName: (name) => name,
    get: (id) => ({
      fetch: async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        const method = typeof input === 'string' ? init.method || 'GET' : input.method || 'GET';
        const body = init.body ?? (typeof input === 'string' ? null : input.body ?? null);
        return getLobbyEntry(id).lobby.fetch({
          url,
          method,
          json: async () => JSON.parse(body || '{}'),
        });
      },
    }),
  },
  ASSETS: { fetch: async () => new ShimResponse('', { status: 404 }) },
};

/* ---------------- HTTP ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');

      const request = {
        url: url.href,
        method: req.method,
        headers: new Headers(req.headers),
        json: async () => JSON.parse(raw || '{}'),
      };

      const out = await worker.fetch(request, env);
      res.writeHead(out.status, out.headers);
      res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body));
      return;
    }

    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = normalize(join(PUBLIC_DIR, path));
    if (!file.startsWith(PUBLIC_DIR)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch (err) {
    if (err?.code !== 'ENOENT') console.error('[http]', err);
    if (!res.headersSent) res.writeHead(404).end('not found');
    else res.end();
  }
});

server.on('upgrade', async (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  socket.on('error', () => {});

  let accepted = null;
  pendingAccept = (ws) => {
    accepted = ws;
  };

  try {
    const out = await worker.fetch(makeRequest(url.href, 'GET', req.headers), env);
    if (out.status !== 101 || !out.webSocket) {
      socket.write(`HTTP/1.1 ${out.status} Error\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }

    handshake(req, socket);
    const shim = accepted;
    if (!shim) throw new Error('没有拿到服务端 socket');

    const entry = getRoom((url.searchParams.get('code') || '').toUpperCase());
    shim.bind(socket);

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const frame = readFrame(buffer);
        if (!frame) break;
        buffer = buffer.subarray(frame.total);

        if (frame.opcode === 0x1) {
          entry.room.webSocketMessage(shim, frame.payload.toString('utf8')).catch(() => {});
        } else if (frame.opcode === 0x8) {
          shim.closed = true;
          socket.end();
          entry.room.webSocketClose(shim).catch(() => {});
        } else if (frame.opcode === 0x9) {
          writeFrame(socket, 0xa, frame.payload);
        }
      }
    });

    socket.on('close', () => {
      if (shim.closed) return;
      shim.closed = true;
      entry.room.webSocketClose(shim).catch(() => {});
    });
  } catch (err) {
    console.error('[upgrade]', err);
    socket.destroy();
  } finally {
    pendingAccept = null;
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`sixdrop dev → http://127.0.0.1:${PORT}`);
});

process.on('unhandledRejection', (err) => console.error('[unhandled]', err));
