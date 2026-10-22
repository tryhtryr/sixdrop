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
  'knock',
  'admit',
  'reject',
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
    if (url.pathname === '/exists') return this.exists();
    if (url.pathname === '/ws') return this.upgrade(request, url);
    return new Response('not found', { status: 404 });
  }

  /** 大厅注册前先确认房间还活着 */
  async exists() {
    const createdAt = await this.ctx.storage.get('createdAt');
    return new Response(createdAt ? 'ok' : 'gone', { status: createdAt ? 200 : 404 });
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

    const device = (url.searchParams.get('device') || '').slice(0, 40);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // 用 Hibernation：空闲房间不计时长费用
    this.ctx.acceptWebSocket(server);
    // 建房者直接准入；同网发现（via=discover）进来的要房主点「同意」，
    // 手输取件码进来的直接准入——6 位码本身就是凭证
    const viaDiscover = url.searchParams.get('via') === 'discover';
    const admitted = role === 'sender' || !viaDiscover;
    server.serializeAttachment({ role, admitted, device });

    server.send(JSON.stringify({ t: 'joined', role, admitted }));

    // 已经在线的一方收到通知，由发送方决定（重新）发 offer。
    // 未准入的访客不能通知对端，否则房主会在审批之前就被拉进房间
    if (admitted) {
      for (const peer of others) {
        try {
          peer.send(JSON.stringify({ t: 'peer-joined', role }));
        } catch {
          /* 忽略 */
        }
      }
    }

    if (!admitted) {
      const owner = others.find((w) => w.deserializeAttachment()?.role === 'sender');

      if (!owner) {
        // 大厅里可能还挂着一条已经关掉的房间：直接回绝，别让访客干等一分钟
        try {
          server.send(
            JSON.stringify({ t: 'reject', message: '对方好像已经离开了，回大厅再看看' }),
          );
        } catch {
          /* 忽略 */
        }
        return new Response(null, { status: 101, webSocket: client });
      }

      try {
        owner.send(JSON.stringify({ t: 'knock', device: device || '未知设备' }));
      } catch {
        /* 忽略 */
      }
    }

    this.broadcastPeers();

    return new Response(null, { status: 101, webSocket: client });
  }

  /** 已准入的连接数（访客未审批时不计数） */
  admittedCount() {
    return this.ctx.getWebSockets().filter((w) => w.deserializeAttachment()?.admitted).length;
  }

  broadcastPeers() {
    this.broadcast({ t: 'peers', n: this.admittedCount() });
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

    const att = ws.deserializeAttachment() || {};
    const from = att.role;

    // 审批：只有房主能放行
    if (msg.t === 'admit' || msg.t === 'reject') {
      if (from !== 'sender') return;
      const guest = this.ctx.getWebSockets().find((w) => w !== ws && w.deserializeAttachment()?.role === 'receiver');
      if (!guest) return;
      const gatt = guest.deserializeAttachment() || {};

      if (msg.t === 'admit') {
        guest.serializeAttachment({ ...gatt, admitted: true });
        try {
          guest.send(JSON.stringify({ t: 'admit' }));
          ws.send(JSON.stringify({ t: 'peer-joined', role: 'receiver', device: gatt.device || '' }));
        } catch {
          /* 忽略 */
        }
      } else {
        try {
          guest.send(JSON.stringify({ t: 'reject', message: msg.message || '房主拒绝了这次加入' }));
          guest.close(4003, 'rejected');
        } catch {
          /* 忽略 */
        }
      }

      this.broadcastPeers();
      return;
    }

    // 没被准入的访客，只能敲门
    if (!att.admitted && msg.t !== 'knock') return;

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
    const admitted = peers.filter((peer) => peer.deserializeAttachment()?.admitted).length;

    for (const peer of peers) {
      try {
        peer.send(JSON.stringify({ t: 'peer-left', from }));
        peer.send(JSON.stringify({ t: 'peers', n: admitted }));
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
