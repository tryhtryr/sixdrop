const ROOM_TTL_MS = 30 * 60 * 1000;
const MAX_SIGNAL_BYTES = 64 * 1024;
const ALLOWED = new Set([
  'offer',
  'answer',
  'ice',
  'accept',
  'decline',
  'bye',
  'ping',
  'relay',
  'relay-request',
  'relay-progress',
  'relay-file',
  'relay-error',
  // 打洞失败时的文字兜底：消息经房间转发，不落盘
  'text',
  'text-relay',
  'fail',
]);

/**
 * 一个房间 = 一个 Durable Object 实例。
 * 只做三件事：占位、转发 SDP、通知上下线。文件数据永远不经过这里。
 */
export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/claim') return this.claim();
    if (url.pathname === '/ws') return this.upgrade(request, url);
    return new Response('not found', { status: 404 });
  }

  async claim() {
    const createdAt = await this.ctx.storage.get('createdAt');
    if (createdAt) return new Response('taken', { status: 409 });

    await this.ctx.storage.put('createdAt', Date.now());
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    return new Response('ok');
  }

  async upgrade(request, url) {
    const role = url.searchParams.get('role');
    if (role !== 'sender' && role !== 'receiver') {
      return new Response('bad role', { status: 400 });
    }

    // 房间必须是被 /claim 创建过的，防止拿错码连到一个空对象上干等
    const createdAt = await this.ctx.storage.get('createdAt');
    if (!createdAt) return new Response('no such room', { status: 404 });

    const current = this.ctx.getWebSockets();

    // 同一个角色重复连接（刷新、重试）：踢掉旧的，让新的顶上来
    const sameRole = current.find((ws) => ws.deserializeAttachment()?.role === role);
    if (sameRole) {
      sameRole.serializeAttachment({ role, replaced: true });
      try {
        sameRole.close(4001, 'replaced');
      } catch {
        /* 忽略 */
      }
    }

    const others = current.filter((ws) => ws !== sameRole);
    if (others.length >= 2) return new Response('room full', { status: 409 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // 用 Hibernation：空闲房间不计时长费用
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role });

    server.send(JSON.stringify({ t: 'joined', role }));

    // 已经在线的一方收到通知，由发送方决定（重新）发 offer
    for (const peer of others) {
      try {
        peer.send(JSON.stringify({ t: 'peer-joined', role }));
      } catch {
        /* 忽略 */
      }
    }

    this.broadcast({ t: 'peers', n: others.length + 1 });

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        /* 对端已断开，忽略 */
      }
    }
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_SIGNAL_BYTES) return;

    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (!ALLOWED.has(msg.t)) return;

    // 角色由服务端判定，不信任客户端自称的身份
    const from = ws.deserializeAttachment()?.role;
    const payload = JSON.stringify({ ...msg, from });

    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) continue;
      try {
        peer.send(payload);
      } catch {
        /* 忽略 */
      }
    }
  }

  async webSocketClose(ws) {
    this.peerGone(ws);
  }

  async webSocketError(ws) {
    this.peerGone(ws);
  }

  peerGone(ws) {
    const att = ws.deserializeAttachment();
    // 被同名角色顶替掉的旧连接，静默退场
    if (att?.replaced) return;

    const from = att?.role;
    const peers = this.ctx.getWebSockets().filter((peer) => peer !== ws);

    for (const peer of peers) {
      try {
        peer.send(JSON.stringify({ t: 'peer-left', from }));
        peer.send(JSON.stringify({ t: 'peers', n: peers.length }));
      } catch {
        /* 忽略 */
      }
    }
  }

  async alarm() {
    // 还有人在线上说明可能正在传大文件，先顺延，别把传输打断
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return;
    }

    await this.ctx.storage.deleteAll();
  }
}
