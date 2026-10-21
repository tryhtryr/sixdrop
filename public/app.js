// 分块上限默认 256 KiB；?chunk=64 可以调小做对比。真正发送时还会按平台的 SCTP 上限收窄
const CHUNK_LIMIT =
  Math.min(256, Math.max(16, Number(new URLSearchParams(location.search).get('chunk')) || 256)) * 1024;
const TUNE = new URLSearchParams(location.search);
const HIGH_WATER = Math.max(2, Math.min(16, Number(TUNE.get('water')) || 8)) * 1024 * 1024;
const LOW_WATER = Math.max(1, Math.min(HIGH_WATER / 1024 / 1024, Number(TUNE.get('low')) || (HIGH_WATER / 1024 / 1024) / 2)) * 1024 * 1024;
const PREFETCH_BYTES = 16 * 1024 * 1024;
const JOIN_TIMEOUT = 8000;
const CONNECT_TIMEOUT = 30000;

// 国内可用的 STUN 放前面；带 AAAA 的放在后面专门探 IPv6
// 手机流量下双方大概率都在 CGNAT 后面，IPv6 是唯一可能绕过去的路
const ICE_SERVERS = [
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.nextcloud.com:3478' },
];

const $ = (id) => document.getElementById(id);

const s = {
  ws: null,
  pc: null,
  dc: null,
  role: null,
  code: null,
  files: [],
  meta: null,
  current: null,
  dir: null,
  pendingSink: null,
  usedNames: new Set(),
  count: 0,
  totalSize: 0,
  receivedTotal: 0,
  sentBytes: 0,
  acceptResolver: null,
  accepted: false,
  relayEnabled: false,
  relayStarted: false,
  rxAt: 0,
  rxBase: 0,
  rxSpeed: 0,
  relayTimer: 0,
  pending: [],
  reconnects: 0,
  dropToken: '',
  textViaServer: false,
  mode: 'file',
  rate: 0,
  speedAt: 0,
  speedBase: 0,
  peerUp: false,
  offerSent: false,
  sending: false,
  done: false,
  joinTimer: 0,
  connectTimer: 0,
  keepaliveTimer: 0,
  lock: null,
  // 候选统计，失败时用来判断到底是 STUN 没通还是对称 NAT
  ice: { host: 0, srflx: 0, relay: 0, v6: 0 },
  // 对端描述还没设好时先攒着候选
  iceBuffer: [],
  // 串行化落盘，避免并发写入同一个文件句柄
  chain: Promise.resolve(),
};

/* ---------------- 界面 ---------------- */

function show(name) {
  for (const el of document.querySelectorAll('.view')) {
    el.hidden = el.id !== `view-${name}`;
  }
}

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

function progress(done, total) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const now = performance.now();

  // 每块都写 DOM 会把主线程吃满，节流到 10 次/秒
  const due = now - (s.lastDomAt || 0) >= 100 || pct >= 100;
  if (due) {
    s.lastDomAt = now;
    $('bar').style.width = `${pct.toFixed(2)}%`;
  }
  if (!s.speedAt) {
    s.speedAt = now;
    s.speedBase = done;
  } else if (now - s.speedAt >= 500) {
    s.rate = ((done - s.speedBase) * 1000) / (now - s.speedAt);
    s.speedAt = now;
    s.speedBase = done;
  }

  if (!due) return;
  const speed = s.rate > 0 ? `${fmtBytes(s.rate)}/s` : '—';
  $('xfer-stats').textContent = `${fmtBytes(done)} / ${fmtBytes(total)} · ${speed} · ${pct.toFixed(0)}%`;
}

/** 多文件时在副标题里显示「第几个 / 总计百分比」 */
function overallLine(doneBytes, totalBytes, index) {
  if (s.count <= 1 || !totalBytes) return;
  const pct = Math.min(100, (doneBytes / totalBytes) * 100).toFixed(0);
  const at = Math.min(s.count, (index ?? s.current?.meta.index ?? 0) + 1);
  $('xfer-sub').textContent = `第 ${at}/${s.count} 个 · 总计 ${pct}%`;
}

function fail(title, text) {
  if (!$('view-error').hidden) return;

  // 文本模式下打洞失败不等于聊不了：信令还通，就把文字改成经服务器转发
  if (s.mode === 'text' && s.ws && s.ws.readyState === WebSocket.OPEN) {
    startTextFallback(title);
    return;
  }

  // 先取诊断快照，closePeer 会清空候选计数
  const diag = diagnostic();

  s.done = true;
  clearTimeout(s.joinTimer);
  clearTimeout(s.connectTimer);
  stopKeepalive();
  keepAwakeOff();
  closePeer();

  $('error-title').textContent = title;
  $('error-text').textContent = text || '';
  $('error-diag').textContent = diag;
  // 发送方有文件可以直接传；接收方只能请对方传
  $('use-relay').hidden = !(
    s.relayEnabled && (s.files.length > 0 || s.role === 'receiver')
  );
  show('error');

  // 让对端也知道这次打不通，否则它会一直停在等待页
  sendSignal({ t: 'fail', title });
}

/**
 * 失败时给出能判断原因的数字：
 * srflx = 0 → STUN 都没打通（换 STUN / 网络禁 UDP）
 * srflx > 0 → 候选有了但配不上对，基本就是对称 NAT
 */
function diagnostic() {
  const { host, srflx, relay, v6 } = s.ice;
  const parts = [
    `候选：host ${host}${v6 ? `（IPv6 ${v6}）` : ''}`,
    `srflx ${srflx}`,
    `relay ${relay}`,
  ];
  const hint =
    srflx === 0
      ? '没有拿到公网映射，STUN 可能被网络拦了'
      : '有公网映射但对不上，典型对称 NAT';
  return `${parts.join(' · ')} — ${hint}`;
}

/* ---------------- 会话初始化 ---------------- */

async function createRoom() {
  const res = await fetch('/api/room', { method: 'POST' });
  if (!res.ok) throw new Error('服务器忙，请稍后重试');
  const data = await res.json();
  return data.code;
}

function connect(role) {
  // 发送方要等对方输码，可能是几分钟，交给房间 TTL 兜底；
  // 接收方 8 秒等不到人，基本就是码错了或房间已过期
  if (role === 'receiver') {
    s.joinTimer = setTimeout(() => {
      if (!s.peerUp && !s.done) {
        fail('没有等到对方', '没有找到发送方：确认取件码有没有输错，或者让对方重新发起。');
      }
    }, JOIN_TIMEOUT);
  }

  openSocket(role);
}

function openSocket(role) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?code=${s.code}&role=${role}`);
  s.ws = ws;

  ws.onopen = () => {
    s.reconnects = 0;
    // 断线期间攒下的消息补发
    while (s.pending.length) {
      const queued = s.pending.shift();
      try {
        ws.send(JSON.stringify(queued));
      } catch {
        s.pending.unshift(queued);
        break;
      }
    }
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    onSignal(msg).catch((err) => fail('信令处理失败', err?.message || String(err)));
  };

  ws.onclose = () => {
    if (!s.code || !s.role) return;

    // 信令断了先自己重连几次，别直接判死刑
    if (s.reconnects < 3) {
      s.reconnects = (s.reconnects || 0) + 1;
      setTimeout(() => {
        if (s.code && s.role && s.ws?.readyState !== WebSocket.OPEN) openSocket(s.role);
      }, 800);
      return;
    }

    if (s.done || s.sending || s.receivedTotal > 0) return;
    fail('连接已断开', '与服务器的信令连接中断了，刷新页面重新开始。');
  };
}

function sendSignal(msg) {
  if (s.ws && s.ws.readyState === WebSocket.OPEN) {
    s.ws.send(JSON.stringify(msg));
    return true;
  }

  // 断线时先攒着，重连成功后补发
  if (s.code && s.role && s.pending.length < 40) s.pending.push(msg);
  return false;
}

async function onSignal(msg) {
  switch (msg.t) {
    case 'joined':
      clearTimeout(s.joinTimer);
      break;

    case 'peers':
      s.peerUp = msg.n >= 2;
      if (s.role === 'sender') {
        $('wait-sub').textContent = s.peerUp ? '对方已进入，正在建立直连…' : '等待对方输入取件码…';
        if (s.peerUp && !s.offerSent) startOffer();
      } else {
        $('wait-sub').textContent = s.peerUp ? '正在建立直连…' : '正在寻找发送方…';
      }
      break;

    case 'offer':
      if (msg.mode) s.mode = msg.mode;
      await onOffer(msg.sdp);
      break;

    case 'answer':
      await onAnswer(msg.sdp);
      break;

    case 'ice':
      if (s.pc?.remoteDescription) {
        try {
          await s.pc.addIceCandidate(msg.c);
        } catch {
          /* 单条候选失败不影响整体 */
        }
      } else {
        s.iceBuffer.push(msg.c);
      }
      break;

    case 'peer-joined':
      // 对端（重新）连接上来：如果还没有在传，就重新发一次 offer
      if (s.role === 'sender' && !s.sending && !s.done) {
        s.offerSent = false;
        startOffer();
      }
      break;

    case 'fail':
      fail(msg.title || '直连失败', '对方那边没能建立直连，可以请他改用中转。');
      break;

    case 'text':
      appendChat(String(msg.body ?? ''), false);
      break;

    case 'text-relay':
      if (!s.textViaServer) startTextFallback('对方直连失败');
      break;

    case 'accept':
      if (s.role === 'sender') {
        s.accepted = true;
        s.acceptResolver?.(true);
        s.acceptResolver = null;
        beginSending();
      }
      break;

    case 'decline':
      if (s.role === 'sender') {
        s.accepted = false;
        s.acceptResolver?.(false);
        s.acceptResolver = null;
        // 拒绝的只是这一批文件，房间和取件码都要留着
        s.sending = false;
        s.busy = false;
        s.done = true;
        s.files = [];
        s.count = 0;
        s.totalSize = 0;
        toast('对方拒绝了这批文件，房间还在，可以换一批再发');
        show('wait');
        $('wait-sub').textContent = '对方拒绝了这次传输，等你重新选文件';
      }
      break;

    case 'relay':
      clearTimeout(s.relayTimer);
      showRelayLinks(msg.files || [], msg.share);
      break;

    case 'relay-progress':
      clearTimeout(s.relayTimer);
      updateRelayProgress(msg);
      break;

    case 'relay-file':
      clearTimeout(s.relayTimer);
      if (msg.url) addRelayRow(msg.name, msg.url, msg.size);
      break;

    case 'relay-error':
      clearTimeout(s.relayTimer);
      if (!$('view-relay').hidden) {
        $('relay-stats').textContent = `对方上传失败：${msg.message || '未知错误'}`;
      } else {
        toast(msg.message || '对方无法中转');
      }
      break;

    case 'relay-request':
      if (s.role === 'sender') {
        if (s.files.length > 0 && !s.relayStarted) {
          toast('对方请求改用中转');
          startRelay();
        } else {
          sendSignal({ t: 'relay-error', message: '对方这次没有要传的文件' });
        }
      }
      break;

    case 'peer-left':
      if (!s.done) {
        // 传输已经走 P2P 通道，信令断开不代表性数据断了——别误杀
        if (!s.sending && s.receivedTotal === 0) toast('对方已离开');
        s.peerUp = false;
      }
      break;
  }
}

/* ---------------- WebRTC ---------------- */

async function startOffer() {
  if (s.done || s.offerSent) return;
  s.offerSent = true;

  let flushIce = () => {};

  try {
    closePeer();
    show('wait');
    $('wait-sub').textContent = '正在建立直连…';

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    s.pc = pc;
    watch(pc);

    // 发送方固定是 offerer，并主动开数据通道
    const dc = pc.createDataChannel('file', { ordered: true });
    wireChannel(dc, true);

    flushIce = attachIce(pc);

    await pc.setLocalDescription(await pc.createOffer());
    sendSignal({ t: 'offer', sdp: pc.localDescription.sdp, mode: s.mode });
    flushIce();
  } catch (err) {
    s.offerSent = false;
    fail('无法发起连接', err?.message || String(err));
  }
}

async function onOffer(sdp) {
  closePeer();
  s.done = false;
  show('wait');
  $('wait-sub').textContent = '正在建立直连…';

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  s.pc = pc;
  watch(pc);

  const flushIce = attachIce(pc);
  pc.ondatachannel = (ev) => wireChannel(ev.channel, false);

  await pc.setRemoteDescription({ type: 'offer', sdp });
  await flushRemoteIce();
  await pc.setLocalDescription(await pc.createAnswer());
  sendSignal({ t: 'answer', sdp: pc.localDescription.sdp });
  flushIce();
}

async function onAnswer(sdp) {
  if (!s.pc) return;
  if (s.pc.signalingState !== 'have-local-offer') return;
  await s.pc.setRemoteDescription({ type: 'answer', sdp });
  await flushRemoteIce();
}

/**
 * trickle ICE：候选一边收集一边发，先把描述发出去再补候选。
 * 这样不用等所有 STUN 都超时，建立连接快 1–3 秒。
 */
function attachIce(pc) {
  const early = [];
  let ready = false;

  pc.onicecandidate = (ev) => {
    if (!ev.candidate) return;

    // 记一下候选类型：host=本机地址，srflx=STUN 探到的公网地址，relay=中继
    const type = ev.candidate.type || 'host';
    if (s.ice[type] !== undefined) s.ice[type] += 1;
    if ((ev.candidate.address || '').includes(':')) s.ice.v6 += 1;

    const candidate = ev.candidate.toJSON();
    if (ready) sendSignal({ t: 'ice', c: candidate });
    else early.push(candidate);
  };

  return () => {
    ready = true;
    for (const candidate of early.splice(0)) sendSignal({ t: 'ice', c: candidate });
  };
}

async function flushRemoteIce() {
  const pending = s.iceBuffer.splice(0);
  for (const candidate of pending) {
    try {
      await s.pc.addIceCandidate(candidate);
    } catch {
      /* 单条候选失败不影响其它 */
    }
  }
}

function watch(pc) {
  clearTimeout(s.connectTimer);
  s.connectTimer = setTimeout(() => {
    if (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') {
      fail('连接超时', '30 秒内没能建立直连，多半是对称 NAT 或防火墙拦住了。');
    }
  }, CONNECT_TIMEOUT);

  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState;
    if (st === 'connected' || st === 'completed') {
      clearTimeout(s.connectTimer);
      showVerify(pc);
    } else if (st === 'failed') {
      fail('打洞失败', '双方网络之间无法建立直连，这是对称 NAT 的典型表现。');
    } else if (st === 'disconnected') {
      setTimeout(() => {
        if (pc.iceConnectionState === 'disconnected' && !s.done) {
          fail('连接中断', '网络在传输过程中发生了变化。');
        }
      }, 8000);
    }
  };
}

function wireChannel(dc, isSender) {
  s.dc = dc;
  dc.binaryType = 'arraybuffer';
  dc.bufferedAmountLowThreshold = LOW_WATER;

  dc.onopen = () => {
    // 通道一开就握手：告诉对方这是文件模式还是纯文字模式
    if (isSender) {
      dc.send(JSON.stringify({ t: 'hello', mode: s.mode }));
    }

    if (s.mode === 'text') {
      showChat('点对点消息');
      return;
    }

    // 通道打开后，如果已经有文件就直接开传；没有就等用户选
    if (isSender && s.files.length) {
      beginSending();
    }
  };

  dc.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (msg.t === 'hello') {
        s.mode = msg.mode === 'text' ? 'text' : 'file';
        if (s.mode === 'text') ensureChatView();
        return;
      }

      if (msg.t === 'text') {
        appendChat(String(msg.body ?? ''), false);
        return;
      }

      if (msg.t === 'accept') {
        s.accepted = true;
        s.acceptResolver?.(true);
        s.acceptResolver = null;
        return;
      }
      if (msg.t === 'decline') {
        s.accepted = false;
        s.acceptResolver?.(false);
        s.acceptResolver = null;
        return;
      }

      // 控制消息和数据块都进同一条链，保证顺序：meta 一定先于它的数据块被处理
      if (msg.t === 'meta') {
        s.chain = s.chain.then(() => onMeta(msg)).catch((err) => fail('接收失败', err?.message || String(err)));
      } else if (msg.t === 'eof') {
        s.chain = s.chain
          .then(() => onFileEnd(msg.i || 0))
          .catch((err) => fail('接收失败', err?.message || String(err)));
      }
      return;
    }
    writeChunk(ev.data);
  };
}

/* ---------------- 纯文本消息 ---------------- */

function showChat(title) {
  if (title) $('chat-title').textContent = title;
  show('chat');
  startKeepalive();
  setTimeout(() => $('chat-input').focus(), 60);
}

/** 直连打不通时的文字兜底：消息走房间信令，不落盘、不存历史 */
function startTextFallback(reason) {
  s.textViaServer = true;
  clearTimeout(s.connectTimer);
  clearTimeout(s.joinTimer);
  keepAwakeOff();
  closePeer();

  $('chat-title').textContent = '文本 · 经服务器转发';
  $('chat-note').textContent = `直连没打通（${reason || '网络受限'}），文字改由服务器转发。仅在本次会话内转发，不保存。`;
  show('chat');
  sendSignal({ t: 'text-relay' });
  setTimeout(() => $('chat-input').focus(), 60);
}

/** 统一出口：能直连就直连，不能就退到信令通道 */
function sendText(body) {
  if (s.dc && s.dc.readyState === 'open') {
    s.dc.send(JSON.stringify({ t: 'text', body }));
    return true;
  }
  if (s.textViaServer) {
    sendSignal({ t: 'text', body });
    return true;
  }
  return false;
}

/** 有消息进来时确保用户在聊天界面 */
function ensureChatView() {
  if (!$('view-chat').hidden) return;
  show('chat');
  startKeepalive();
  toast('收到一条文本消息');
  setTimeout(() => $('chat-input').focus(), 60);
}

function appendChat(body, mine) {
  const text = body.trim();
  if (!text) return;

  const li = document.createElement('li');
  li.className = mine ? 'mine' : 'theirs';
  li.textContent = text;
  if (!mine) ensureChatView();
  $('chat-list').appendChild(li);
  $('chat-list').scrollTop = $('chat-list').scrollHeight;
}

function startTextChat() {
  resetAll();
  s.mode = 'text';
  s.role = 'sender';

  show('wait');
  $('wait-hint').textContent = '把取件码发给对方';
  $('room-code').textContent = '······';
  $('wait-sub').textContent = '正在创建房间…';
  $('copy').hidden = true;

  createRoom()
    .then((code) => {
      s.code = code;
      $('room-code').textContent = code;
      $('copy').hidden = false;
      $('wait-sub').textContent = '等待对方输入取件码…';
      connect('sender');
    })
    .catch((err) => fail('创建房间失败', err?.message || String(err)));
}

async function onFileEnd(index) {
  await closeCurrent();
  if (index >= s.count - 1) await finishReceive();
}

/* ---------------- 发送 ---------------- */

/** 传大文件时信令可能长时间空闲，定时 ping 一下保活 */
function startKeepalive() {
  stopKeepalive();
  s.keepaliveTimer = setInterval(() => sendSignal({ t: 'ping' }), 30000);
}

function stopKeepalive() {
  clearInterval(s.keepaliveTimer);
  s.keepaliveTimer = 0;
}

async function beginSending() {
  if (s.sending || !s.files.length || !s.dc) return;
  s.sending = true;
  s.done = false;
  s.count = s.files.length;
  s.totalSize = s.files.reduce((n, f) => n + f.size, 0);
  s.sentBytes = 0;

  show('xfer');
  await keepAwake();
  startKeepalive();

  const dc = s.dc;
  // 按平台能力收窄分块：Chrome/Edge 给 256 KiB，老的实现只有 64 KiB
  const maxMessage = s.pc?.sctp?.maxMessageSize || 64 * 1024;
  const chunkSize = Math.max(16 * 1024, Math.min(CHUNK_LIMIT, maxMessage));

  // Chrome 的 bufferedAmountLowThreshold 默认是 0，只会在缓冲彻底排空时触发；
  // 设成一半，发送端就能在管道没空之前补货。
  dc.bufferedAmountLowThreshold = Math.floor(LOW_WATER);

  try {
    for (let i = 0; i < s.files.length; i += 1) {
      const file = s.files[i];

      // 文件可能是连上之后才选的，所有 meta 都在这里发
      {
        dc.send(
          JSON.stringify({
            t: 'meta',
            name: file.name,
            size: file.size,
            type: file.type || 'application/octet-stream',
            index: i,
            total: s.files.length,
            totalBytes: s.totalSize,
          }),
        );
      }

      // 只有第一个文件需要等对方确认；确认一次，后面自动接着传
      let warm = null;
      if (i === 0) {
        // 对方点「接收」前有几秒空闲，这段时间先把开头读进内存，
        // 否则握手完成后的第一次读盘（手机上尤其慢）会把开头拖成龟速
        // 预读在 dc.onopen 时就已经启动（见 wireChannel），这里复用；
        // 万一没启动（例如多文件后的第 2 批），再现场开一个
        const warmPromised =
          s.warmPromise && i === 0
            ? s.warmPromise
            : prefetch(file, chunkSize, PREFETCH_BYTES);
        const accepted = await waitAccept();
        if (!accepted) return;
        warm = await warmPromised;
        s.warmPromise = null;
      }

      $('xfer-name').textContent = file.name;
      s.speedAt = 0;
      s.rate = 0;
      overallLine(s.sentBytes, s.totalSize, i);
      progress(0, file.size);

      let offset = 0;
      let warmIndex = 0;
      while (offset < file.size) {
        if (s.done) return;
        await waitForDrain(dc);
        const buf =
          warm && warmIndex < warm.length
            ? warm[warmIndex++]
            : await file.slice(offset, offset + chunkSize).arrayBuffer();
        await sendChunk(dc, buf);
        offset += buf.byteLength;
        s.sentBytes += buf.byteLength;
        progress(offset, file.size);
        overallLine(s.sentBytes, s.totalSize, i);
      }

      // 空文件没有数据块，靠这一条让接收端收尾
      dc.send(JSON.stringify({ t: 'eof', i }));
    }

    s.done = true;
    $('xfer-sub').textContent = s.files.length > 1 ? '全部发送完成' : '发送完成';
    $('back').hidden = false;
    stopKeepalive();
    keepAwakeOff();
  } catch (err) {
    fail('发送失败', err?.message || String(err));
  }
}

/** 预读开头若干 MB，返回按顺序切好的 ArrayBuffer */
async function prefetch(file, chunkSize, limit) {
  const bufs = [];
  let off = 0;
  const end = Math.min(file.size, limit);
  try {
    while (off < end) {
      const b = await file.slice(off, off + chunkSize).arrayBuffer();
      if (!b.byteLength) break;
      bufs.push(b);
      off += b.byteLength;
    }
  } catch {
    /* 预读失败不影响正常流程，后面照常按需读取 */
  }
  return bufs;
}

function waitAccept() {
  if (s.accepted) return Promise.resolve(true);
  return new Promise((resolve) => {
    s.acceptResolver = resolve;
    // 对方一直不点，别让发送方无限停在「准备中」
    setTimeout(() => {
      if (s.acceptResolver === resolve) {
        s.acceptResolver = null;
        resolve(false);
      }
    }, 60000);
  });
}

/** 队列满时等一拍再重试，别让一次抖动把整个传输打死 */
async function sendChunk(dc, buf) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      dc.send(buf);
      return;
    } catch (err) {
      if (!/queue is full/i.test(err?.message || '') || attempt > 40) throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

function waitForDrain(dc) {
  if (dc.bufferedAmount < HIGH_WATER) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      dc.removeEventListener('bufferedamountlow', done);
      resolve();
    };
    const timer = setTimeout(done, 500);
    dc.addEventListener('bufferedamountlow', done);
  });
}

/* ---------------- 接收 ---------------- */

function askToReceive(meta) {
  s.meta = meta;
  s.count = meta.total || 1;
  s.totalSize = meta.totalBytes || meta.size;
  s.receivedTotal = 0;

  const streamable = s.count > 1 ? !!window.showDirectoryPicker : !!window.showSaveFilePicker;
  let note;
  if (streamable) {
    note = s.count > 1 ? ' · 选一个文件夹全部保存' : ' · 确认后由你自己选择保存位置';
  } else if (s.totalSize > 1024 ** 3) {
    note = ' · 当前浏览器不支持流式写入，这个体积很可能失败，建议换 Chrome / Edge';
  } else {
    note = ' · 当前浏览器不支持流式写入，会先收在内存里';
  }

  const sizeLine =
    s.count > 1 ? `共 ${s.count} 个文件、${fmtBytes(s.totalSize)}` : fmtBytes(meta.size);

  $('ask-name').textContent = meta.name;
  $('ask-size').textContent = sizeLine + note;
  show('ask');
}

/** 为第 index 个文件开一条写入通道 */
async function openSink(meta, index) {
  if (s.pendingSink) {
    const sink = s.pendingSink;
    s.pendingSink = null;
    return sink;
  }

  if (s.dir) {
    const handle = await s.dir.getFileHandle(uniqueName(meta.name), { create: true });
    const writable = await handle.createWritable();
    return { kind: 'dir', write: (buf) => writable.write(buf), close: () => writable.close() };
  }

  // Firefox / Safari 兜底：先放内存，结束时各自触发下载
  const parts = [];
  return {
    kind: 'memory',
    write: async (buf) => {
      parts.push(buf);
    },
    close: async () => {
      const blob = new Blob(parts, { type: meta.type || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
  };
}

/** 同名文件自动加 (1)(2)，避免互相覆盖 */
function uniqueName(name) {
  let final = name;
  let n = 1;
  while (s.usedNames.has(final)) {
    const dot = name.lastIndexOf('.');
    final = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
    n += 1;
  }
  s.usedNames.add(final);
  return final;
}

async function onMeta(meta) {
  // 第一个文件交给用户确认；后面的自动接着收
  if ((meta.index || 0) === 0) {
    askToReceive(meta);
    return;
  }

  await closeCurrent();
  s.current = { meta, received: 0, closed: false, sink: null };
  updateHeader(meta);
}

function updateHeader(meta) {
  $('xfer-name').textContent = meta.name;
  s.speedAt = 0;
  s.rate = 0;
  progress(0, meta.size);
  overallLine(s.receivedTotal, s.totalSize, meta.index || 0);
}

async function closeCurrent() {
  const cur = s.current;
  if (!cur || cur.closed) return;
  cur.closed = true;
  try {
    await cur.sink?.close();
  } catch (err) {
    fail('保存文件失败', err?.message || String(err));
  }
  s.current = null;
}

function writeChunk(buf) {
  s.chain = s.chain
    .then(() => writeOne(buf))
    .catch((err) => fail('写入本地文件失败', err?.message || String(err)));
}

async function writeOne(buf) {
  const cur = s.current;
  if (!cur || cur.closed || s.done) return;

  // 通道打开可能慢于第一个数据块，懒加载一次
  if (!cur.sink) cur.sink = await openSink(cur.meta, cur.meta.index || 0);

  await cur.sink.write(buf);
  cur.received += buf.byteLength;
  s.receivedTotal += buf.byteLength;
  progress(cur.received, cur.meta.size);
  overallLine(s.receivedTotal, s.totalSize, cur.meta.index || 0);
}

async function finishReceive() {
  if (s.done) return;
  s.done = true;

  await closeCurrent();
  $('xfer-sub').textContent = s.totalSize && s.count > 1 ? '全部接收完成' : '已保存';
  $('back').hidden = false;
  stopKeepalive();
  keepAwakeOff();
}

/* ---------------- 中转兜底（打洞失败时） ---------------- */

async function startRelay() {
  if (!s.files.length || s.relayStarted) return;
  s.relayStarted = true;

  show('relay');
  $('relay-title').textContent = '中转上传';
  $('relay-note').textContent = '打洞没成功，改为经服务器中转。文件临时存放在 Cloudflare R2，24 小时后自动删除。';
  $('relay-list').innerHTML = '';
  $('relay-download').hidden = true;
  $('relay-retry').hidden = true;
  $('relay-stats').textContent = '正在签名…';

  const total = s.files.reduce((n, f) => n + f.size, 0);
  const links = [];
  let done = 0;
  let lastPing = 0;

  try {
    for (const file of s.files) {
      const index = links.length;
      const { url, key } = await uploadOne(file, (loaded) => {
        const sent = done + loaded;
        const pct = total ? (sent / total) * 100 : 0;
        $('relay-bar').style.width = `${Math.min(100, pct).toFixed(1)}%`;
        $('relay-stats').textContent = `上传中 ${file.name} · ${pct.toFixed(0)}%`;

        // 节流上报，让对方也能看到进度（首个进度不节流，保证一定发出去）
        const now = Date.now();
        if (now - lastPing > 400) {
          lastPing = now;
          sendSignal({
            t: 'relay-progress',
            done: sent,
            total,
            index,
            count: s.files.length,
            name: file.name,
          });
        }
      });

      done += file.size;
      const item = { name: file.name, size: file.size, url, key };
      links.push(item);
      addRelayRow(file.name, url, file.size);
      // 每个文件一传完就推过去，对方可以一边收一边下
      sendSignal({ t: 'relay-file', ...item });
    }

    // 建一个可离线访问的分享页：对方关了页面也能靠这个链接回来拿
    let share = null;
    try {
      const res = await fetch('/api/drop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          files: links.map((f) => ({ name: f.name, size: f.size, key: f.key })),
        }),
      });
      if (res.ok) {
        const info = await res.json();
        share = info.url;
        s.dropToken = info.token;
      }
    } catch {
      /* 分享页失败不影响主流程 */
    }

    if (share) showShare(share);
    $('relay-bar').style.width = '100%';
    $('relay-stats').textContent = share ? '上传完成，链接已发给对方' : '上传完成';
    sendSignal({ t: 'relay', files: links, share });
  } catch (err) {
    // 失败后允许重来，不然用户只能刷新整页
    s.relayStarted = false;
    $('relay-retry').hidden = false;
    $('relay-stats').textContent = `中转失败：${err?.message || err}`;
    sendSignal({ t: 'relay-error', message: err?.message || String(err) });
  }
}

async function uploadOne(file, onProgress) {
  const res = await fetch('/api/relay/sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: file.name, size: file.size }),
  });
  const sign = await res.json();
  if (!res.ok) throw new Error(sign.error || '签名失败');

  if (sign.mode === 'put') {
    await putBlob(sign.url, file, onProgress);
    const link = await fetch(`/api/relay/link?key=${encodeURIComponent(sign.key)}`).then((r) => r.json());
    return { url: link.url, key: sign.key };
  }

  // 超过 5 GiB：分片上传。中途失败要把没完成的分片传取消掉，不然 R2 上会一直留着
  try {
    const parts = [];
    for (let i = 0; i < sign.urls.length; i += 1) {
      const start = i * sign.partSize;
      const blob = file.slice(start, Math.min(start + sign.partSize, file.size));
      const etag = await putBlob(sign.urls[i], blob, (loaded) => onProgress(start + loaded));
      parts.push({ partNumber: i + 1, etag });
    }

    const done = await fetch('/api/relay/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: sign.key, uploadId: sign.uploadId, parts }),
    }).then((r) => r.json());

    if (!done.url) throw new Error(done.error || '合并分片失败');
    return { url: done.url, key: sign.key };
  } catch (err) {
    fetch('/api/relay/abort', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: sign.key, uploadId: sign.uploadId }),
    }).catch(() => {});
    throw err;
  }
}

function putBlob(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.getResponseHeader('ETag') || '');
      else reject(new Error(`上传失败 HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('上传网络错误'));
    xhr.send(blob);
  });
}

function addRelayRow(name, url, size) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = url;
  a.textContent = name;
  a.rel = 'noreferrer';
  li.appendChild(a);
  if (size) li.append(` · ${fmtBytes(size)}`);
  $('relay-list').appendChild(li);
}

function requestRelay() {
  if (!sendSignal({ t: 'relay-request' })) {
    toast('正在重新连接服务器，稍后会自动补发请求');
  }
  show('relay');
  $('relay-title').textContent = '等待对方上传';
  $('relay-note').textContent =
    '已通知发送方改用中转。对方开始上传后这里会显示进度，传完一个文件就能先下一个。';
  $('relay-list').innerHTML = '';
  $('relay-bar').style.width = '0%';
  $('relay-stats').textContent = '等待发送方上传…';
  $('relay-download').hidden = true;
  $('relay-share').hidden = true;
  s.rxAt = 0;
  s.rxBase = 0;
  s.rxSpeed = 0;

  // 15 秒内没有任何动静，就当对方已经离开
  clearTimeout(s.relayTimer);
  s.relayTimer = setTimeout(() => {
    if ($('view-relay').hidden) return;
    if ($('relay-list').children.length) return;
    $('relay-stats').textContent =
      '对方没有响应，可能已经离开了页面。把取件码再发一次，或者换个网络重试。';
  }, 15000);
}

/** 接收方实时显示对方的上传进度、速度和剩余时间 */
function updateRelayProgress(msg) {
  if ($('view-relay').hidden) {
    show('relay');
    $('relay-title').textContent = '对方正在上传';
    $('relay-note').textContent =
      '打洞没成功，对方正在把文件传到服务器。链接会逐个出现，出现一个就能先下。';
    $('relay-list').innerHTML = '';
    $('relay-download').hidden = true;
    s.rxAt = 0;
    s.rxSpeed = 0;
  }

  const pct = msg.total ? Math.min(100, (msg.done / msg.total) * 100) : 0;
  $('relay-bar').style.width = `${pct.toFixed(1)}%`;

  const now = Date.now();
  if (!s.rxAt) {
    s.rxAt = now;
    s.rxBase = msg.done;
  } else if (now - s.rxAt > 1200) {
    s.rxSpeed = ((msg.done - s.rxBase) * 1000) / (now - s.rxAt);
    s.rxAt = now;
    s.rxBase = msg.done;
  }

  const parts = [
    `对方正在上传 ${fmtBytes(msg.done)} / ${fmtBytes(msg.total)}`,
    `${pct.toFixed(0)}%`,
  ];
  if (s.rxSpeed > 0) parts.push(`${fmtBytes(s.rxSpeed)}/s`);
  const eta = s.rxSpeed > 0 ? (msg.total - msg.done) / s.rxSpeed : 0;
  if (eta > 2) parts.push(`还需 ${fmtDuration(eta)}`);
  $('relay-stats').textContent = parts.join(' · ');
}

function fmtDuration(seconds) {
  const total = Math.round(seconds);
  if (total < 60) return `${total} 秒`;
  const m = Math.floor(total / 60);
  if (m < 60) return `${m} 分 ${total % 60} 秒`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

function showRelayLinks(files, share) {
  show('relay');
  $('relay-title').textContent = '对方发来文件（中转）';
  $('relay-note').textContent =
    '文件经服务器中转。下载链接 1 小时内有效，文件 24 小时后自动删除。';
  $('relay-bar').style.width = '100%';
  $('relay-stats').textContent = `共 ${files.length} 个文件`;
  $('relay-list').innerHTML = '';

  for (const f of files) addRelayRow(f.name, f.url, f.size);

  if (share) {
    showShare(share);
    s.dropToken = share.split('/d/')[1] || s.dropToken;
  }
  $('relay-download').hidden = files.length === 0;
  $('relay-delete').hidden = !s.dropToken;
  clearTimeout(s.relayTimer);
}

function showShare(url) {
  const a = $('relay-share-url');
  a.href = url;
  a.textContent = url;
  $('relay-share').hidden = false;
}

/* ---------------- 生命周期 ---------------- */

function closePeer() {
  clearTimeout(s.connectTimer);
  s.iceBuffer = [];
  s.ice = { host: 0, srflx: 0, relay: 0, v6: 0 };
  if (s.dc) {
    try {
      s.dc.close();
    } catch {
      /* 忽略 */
    }
  }
  if (s.pc) {
    try {
      s.pc.close();
    } catch {
      /* 忽略 */
    }
  }
  s.dc = null;
  s.pc = null;
}

function resetAll() {
  clearTimeout(s.joinTimer);
  clearTimeout(s.connectTimer);
  clearTimeout(s.relayTimer);
  stopKeepalive();
  keepAwakeOff();
  closePeer();

  if (s.ws) {
    // 先摘回调：旧连接的 onclose 会拿新房间的 code 去重连，导致双连接
    s.ws.onopen = null;
    s.ws.onmessage = null;
    s.ws.onclose = null;
    try {
      s.ws.close();
    } catch {
      /* 忽略 */
    }
  }

  s.ws = null;
  s.code = null;
  s.files = [];
  s.meta = null;
  s.current = null;
  s.dir = null;
  s.pendingSink = null;
  s.usedNames = new Set();
  s.count = 0;
  s.totalSize = 0;
  s.receivedTotal = 0;
  s.sentBytes = 0;
  s.acceptResolver?.(false);
  s.acceptResolver = null;
  s.accepted = false;
  s.relayStarted = false;
  s.rxAt = 0;
  s.rxBase = 0;
  s.rxSpeed = 0;
  s.relayTimer = 0;
  s.pending = [];
  s.reconnects = 0;
  s.dropToken = '';
  s.warmPromise = null;
  s.textViaServer = false;
  s.mode = 'file';
  s.rate = 0;
  s.speedAt = 0;
  s.speedBase = 0;
  s.peerUp = false;
  s.offerSent = false;
  s.sending = false;
  s.done = false;
  s.chain = Promise.resolve();

  $('bar').style.width = '0%';
  $('xfer-stats').textContent = '准备中…';
  $('xfer-sub').textContent = '';
  $('xfer-name').textContent = '—';
  $('verify').hidden = true;
  $('back').hidden = true;
  $('relay-delete').hidden = true;
  $('relay-delete').disabled = false;
  $('relay-retry').hidden = true;
  $('relay-share').hidden = true;
  $('chat-list').innerHTML = '';
  $('chat-input').value = '';
  $('chat-input').style.height = 'auto';
  $('chat-note').textContent = '消息走 P2P 直连，不经过服务器。关掉页面就没了。';
  $('chat-title').textContent = '点对点消息';
  $('room-code').textContent = '------';
  $('wait-sub').textContent = '等待对方输入取件码…';
}

async function keepAwake() {
  try {
    s.lock = await navigator.wakeLock.request('screen');
  } catch {
    s.lock = null;
  }
}

function keepAwakeOff() {
  try {
    s.lock?.release();
  } catch {
    /* 忽略 */
  }
  s.lock = null;
}

async function showVerify(pc) {
  const local = fingerprint(pc.localDescription?.sdp);
  const remote = fingerprint(pc.remoteDescription?.sdp);
  if (!local || !remote) return;

  const bytes = new TextEncoder().encode([local, remote].sort().join('|'));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const code = Array.from(digest.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  $('verify-code').textContent = code;
  $('verify').hidden = false;
  describePath(pc);
}

/**
 * 显示出这条连接到底怎么走的：局域网 / 公网打洞 / 中继。
 * 同一个 Wi-Fi 下如果显示的是「公网直连」，说明流量绕到了路由器外面。
 */
async function describePath(pc) {
  try {
    const stats = await pc.getStats();
    const pairs = [];
    stats.forEach((r) => {
      if (r.type === 'candidate-pair' && r.state === 'succeeded') pairs.push(r);
    });
    const pair = pairs.find((p) => p.selected || p.nominated) || pairs[0];
    if (!pair) return;

    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    const type = local?.candidateType || remote?.candidateType;

    const label = type === 'host' ? '局域网直连' : type === 'relay' ? '中继' : '公网打洞';
    const el = $('path');
    el.textContent = `· ${label}`;
    el.hidden = false;
  } catch {
    /* 统计拿不到就算了 */
  }
}

function fingerprint(sdp) {
  const m = /a=fingerprint:\S+\s+([0-9A-Fa-f:]+)/.exec(sdp || '');
  return m ? m[1].replace(/:/g, '').toUpperCase() : null;
}

/* ---------------- 入口 ---------------- */

async function startSend(fileList) {
  const files = [...(fileList || [])].filter((f) => f.size > 0);
  if (!files.length) {
    if (fileList && fileList.length) toast('空文件没有传输的必要');
    return;
  }

  resetAll();
  s.files = files;
  s.count = files.length;
  s.totalSize = files.reduce((n, f) => n + f.size, 0);
  s.role = 'sender';

  $('wait-hint').textContent = '把取件码发给对方';
  $('room-code').textContent = '······';
  $('wait-sub').textContent =
    files.length > 1 ? `已选 ${files.length} 个文件 · 正在创建房间…` : '正在创建房间…';
  $('copy').hidden = true;
  show('wait');

  try {
    s.code = await createRoom();
  } catch (err) {
    fail('创建房间失败', err.message);
    return;
  }

  $('room-code').textContent = s.code;
  $('copy').hidden = false;
  $('wait-sub').textContent =
    files.length > 1 ? `已选 ${files.length} 个文件 · 等待对方输入取件码…` : '等待对方输入取件码…';
  connect('sender');
}

function startReceive(code) {
  resetAll();
  s.role = 'receiver';
  s.code = code;

  $('wait-hint').textContent = '正在连接发送方';
  $('room-code').textContent = code;
  $('copy').hidden = true;
  $('wait-sub').textContent = '正在寻找发送方…';
  show('wait');

  connect('receiver');
}

// 带 ?c= 打开时自动加入，省掉手输 6 位码
(() => {
  const fromLink = (new URLSearchParams(location.search).get('c') || '').trim().toUpperCase();
  if (!/^[2-9A-HJ-NP-Z]{6}$/.test(fromLink)) return;
  $('code').value = fromLink;
  window.__skipBoot = true;
  history.replaceState(null, '', location.pathname);
  toast(`通过链接加入：${fromLink}`);
  startReceive(fromLink);
})();

/** 打开页面就建房：先给码，文件可以等会儿再选 */
async function boot() {
  // 从分享链接进来时，startReceive 已经接管，别再建一个自己的房间
  if (window.__skipBoot) return;
  resetAll();
  s.role = 'sender';

  $('wait-hint').textContent = '把取件码发给对方';
  $('room-code').textContent = '······';
  $('wait-sub').textContent = '正在创建房间…';
  $('copy').hidden = true;
  show('wait');

  try {
    s.code = await createRoom();
  } catch {
    show('start'); // 建房失败就退回选择页，功能不受影响
    return;
  }

  $('room-code').textContent = s.code;
  $('copy').hidden = false;
  $('wait-sub').textContent = '等待对方输入取件码…';
  connect('sender');
}

$('file').addEventListener('change', (ev) => {
  const files = ev.target.files;
  startSend(files);
  ev.target.value = '';
});

const drop = $('drop');
drop.addEventListener('dragover', (ev) => {
  ev.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (ev) => {
  ev.preventDefault();
  drop.classList.remove('over');
  startSend(ev.dataTransfer?.files);
});

/** 分享链接：对方点开就自动填码加入 */
function shareLink(code) {
  return `${location.origin}/?c=${code}`;
}

$('copy-link').addEventListener('click', async () => {
  if (!s.code) return;
  try {
    await navigator.clipboard.writeText(shareLink(s.code));
    toast('链接已复制，发给对方点开即可');
  } catch {
    toast('复制失败，请手动选中');
  }
});

$('file-wait').addEventListener('change', (ev) => {
  const files = [...ev.target.files].filter((f) => f.size > 0);
  ev.target.value = '';
  if (!files.length) return;

  s.files = files;
  s.count = files.length;
  s.totalSize = files.reduce((n, f) => n + f.size, 0);

  const label = $('wait-files');
  label.hidden = false;
  label.textContent = `已选 ${files.length} 个文件 · ${fmtBytes(s.totalSize)}，对方进来就开始传`;

  // 如果对方已经在房间里、通道也开着，立刻开传
  if (s.dc && s.dc.readyState === 'open') beginSending();
});

$('join').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const code = $('code').value.trim().toUpperCase();
  if (!/^[2-9A-HJ-NP-Z]{6}$/.test(code)) {
    toast('取件码是 6 位，不含 0/1/I/O');
    return;
  }
  // 统一入口：和分享链接走同一条路（已验证），避免两套流程打架
  location.href = `/?c=${code}`;
});

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(s.code || '');
    toast('已复制');
  } catch {
    toast('复制失败，请手动选中');
  }
});

$('accept').addEventListener('click', async () => {
  const multi = s.count > 1;

  try {
    if (multi && window.showDirectoryPicker) {
      s.dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    } else if (!multi && window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({ suggestedName: s.meta.name });
      const writable = await handle.createWritable();
      s.pendingSink = {
        kind: 'disk',
        write: (buf) => writable.write(buf),
        close: () => writable.close(),
      };
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      // 用户取消了保存对话框：得回一个 decline，否则发送方会一直停在「准备中」
      sendSignal({ t: 'decline' });
      toast('已取消接收');
      resetAll();
      boot();
      return;
    }
    fail('无法创建本地文件', err?.message || String(err));
    return;
  }

  if (!s.dir && !s.pendingSink) {
    toast(
      multi
        ? '当前浏览器不支持选文件夹，将逐个下载（大文件可能失败）'
        : '当前浏览器不支持流式写入，大文件可能失败',
    );
  }

  s.done = false;
  // 优先走数据通道确认：此刻它已经开着，不会因为信令掉线丢失
  try {
    if (s.dc && s.dc.readyState === 'open') s.dc.send(JSON.stringify({ t: 'accept' }));
  } catch {
    /* 退回信令 */
  }
  sendSignal({ t: 'accept' });

  s.current = { meta: s.meta, received: 0, closed: false, sink: null };
  show('xfer');
  await keepAwake();
  startKeepalive();
  updateHeader(s.meta);
});

$('decline').addEventListener('click', () => {
  sendSignal({ t: 'decline' });
  resetAll();
  show('start');
});

// 用当前房间直接聊，不再另建一个房间
$('to-text').addEventListener('click', () => {
  s.mode = 'text';
  show('chat');
  startKeepalive();
  if (s.dc && s.dc.readyState === 'open') {
    try {
      s.dc.send(JSON.stringify({ t: 'hello', mode: 'text' }));
    } catch {
      /* 忽略 */
    }
  }
  setTimeout(() => $('chat-input').focus(), 60);
});

$('cancel').addEventListener('click', () => {
  resetAll();
  show('start');
});

$('home').addEventListener('click', () => {
  resetAll();
  show('start');
});

$('back').addEventListener('click', () => {
  resetAll();
  show('start');
});

function selectTab(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.id === `tab-${name}`;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  $('panel-file').hidden = name !== 'file';
  $('panel-text').hidden = name !== 'text';
}

$('tab-file').addEventListener('click', () => selectTab('file'));
$('tab-text').addEventListener('click', () => selectTab('text'));

$('text-start').addEventListener('click', () => {
  startTextChat();
});

/** 多行输入框跟着内容长高，最多 132px 后内部滚动 */
function autoGrowChatInput() {
  const el = $('chat-input');
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
}

$('chat-input').addEventListener('input', autoGrowChatInput);

// 触屏设备没有 Shift 键，回车应该老老实实换行；发送交给按钮
const TOUCH = window.matchMedia('(pointer: coarse)').matches;

$('chat-input').placeholder = TOUCH
  ? '输入消息，可换行，点右侧发送'
  : '输入消息，回车发送，Shift+回车换行';

$('chat-input').addEventListener('keydown', (ev) => {
  if (TOUCH) return; // 手机：回车即换行
  if (ev.key !== 'Enter' || ev.shiftKey) return;
  // 中文输入法正在组字时，回车是「上屏」不是「发送」
  if (ev.isComposing || ev.keyCode === 229) return;
  ev.preventDefault();
  $('chat-form').requestSubmit();
});

$('chat-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const body = $('chat-input').value.trim();
  if (!body) return;

  if (!sendText(body)) {
    toast('连接还没建立好，稍等一下');
    return;
  }

  appendChat(body, true);
  $('chat-input').value = '';
  autoGrowChatInput();
});

$('chat-back').addEventListener('click', () => {
  if (s.code) {
    show('wait');
    return;
  }
  resetAll();
  show('start');
});

$('use-relay').addEventListener('click', () => {
  if (s.role === 'sender') startRelay();
  else requestRelay();
});

$('relay-back').addEventListener('click', () => {
  resetAll();
  show('start');
});

$('relay-download').addEventListener('click', () => {
  // 依次触发，避免被浏览器当成弹窗拦掉
  [...document.querySelectorAll('#relay-list a')].forEach((a, i) => {
    setTimeout(() => a.click(), i * 400);
  });
});

$('copy-share').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('relay-share-url').href);
    toast('链接已复制');
  } catch {
    toast('复制失败，请手动选中');
  }
});

/* 分享页：/d/<token>，对方关了页面也能靠这个链接回来拿 */
const shareMatch = /^\/d\/([2-9A-HJ-NP-Z]{10})$/.exec(location.pathname);
if (shareMatch) {
  fetch(`/api/drop/${shareMatch[1]}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? '链接不存在或已过期' : '加载失败'))))
    .then((data) => {
      showRelayLinks(data.files || []);
      $('relay-title').textContent = '别人分享给你的文件';
      $('relay-note').textContent = '文件经服务器中转。下载链接 1 小时内有效，文件 24 小时后自动删除。';
      s.dropToken = shareMatch[1];
      $('relay-delete').hidden = false;
    })
    .catch((err) => {
      show('error');
      $('error-title').textContent = '链接失效';
      $('error-text').textContent = err.message || '这个分享链接不存在或已过期。';
      $('error-diag').textContent = '';
      $('use-relay').hidden = true;
      $('retry').hidden = true;
    });
}

fetch('/api/relay/status')
  .then((r) => r.json())
  .then((v) => {
    s.relayEnabled = Boolean(v.enabled);
  })
  .catch(() => {});

$('relay-retry').addEventListener('click', () => {
  $('relay-retry').hidden = true;
  startRelay();
});

$('relay-delete').addEventListener('click', async () => {
  if (!s.dropToken) return;
  if (!confirm('确认已经收到文件？删除后链接立即失效，无法再下载。')) return;

  $('relay-delete').disabled = true;
  try {
    const res = await fetch('/api/drop/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: s.dropToken }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '删除失败');

    $('relay-list').innerHTML = '';
    $('relay-bar').style.width = '0%';
    $('relay-stats').textContent = `已删除服务器上的 ${data.deleted || 0} 个文件副本`;
    $('relay-download').hidden = true;
    $('relay-delete').hidden = true;
    $('relay-share').hidden = true;
    s.dropToken = '';
  } catch (err) {
    $('relay-stats').textContent = `删除失败：${err?.message || err}`;
    $('relay-delete').disabled = false;
  }
});

$('retry').addEventListener('click', () => {
  const role = s.role;
  const code = s.code;
  const files = s.files;

  resetAll();
  s.role = role;
  s.code = code;
  s.files = role === 'sender' ? files : [];
  s.count = s.files.length;
  s.totalSize = s.files.reduce((n, f) => n + f.size, 0);

  show('wait');
  $('room-code').textContent = code;
  $('wait-hint').textContent = role === 'sender' ? '把取件码发给对方' : '正在连接发送方';
  $('wait-sub').textContent = role === 'sender' ? '等待对方…' : '等待对方重新发起…';

  connect(role);
});

boot();

window.addEventListener('beforeunload', () => {
  try {
    s.pc?.close();
    s.ws?.close();
  } catch {
    /* 忽略 */
  }
});
