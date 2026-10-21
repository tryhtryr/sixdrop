# 房间模型技术方案（阶段 1–3）

> 目标：打开页面即拿到取件码；房间常驻；直连是房间之上的加速通道，不是前提。

## 一、核心分层

```
房间（WebSocket / Durable Object）      ← 永远存在，建房即可用
  ├─ 直连（WebRTC DataChannel）         ← 可选加速通道
  └─ 文件中转（R2 上传 + 链接）          ← 直连不可用时的文件通道
```

**关键变化**：`peer-joined` 是 WS 事实，不再等直连成功。对方进房立刻可见。

## 二、状态机

| 状态 | 触发 | 文本通道 | 文件通道 | 头部显示 |
|---|---|---|---|---|
| `waiting` | 建房后无人 | — | — | 等待对方输入取件码 |
| `connecting` | 对方已进房，正在打洞 | WS（可提前发） | 暂不可用 | 正在建立直连… |
| `p2p` | DC 打开 | DataChannel | DataChannel | 已直连 · 23 MB/s |
| `server` | 打洞失败 | WS 转发 | R2 上传 → 聊天区发链接 | 直连失败 · 已切服务器 |

`server` 状态下可点「重新尝试直连」，成功则回到 `p2p`。

## 三、协议（WS 信令，在现有 ALLOWED 上新增）

```
knock      访客 → 房主   请求加入（携带设备名）
admit      房主 → 访客   同意
reject     房主 → 访客   拒绝（带原因）
device     双方          设备名/平台，用于同网列表与房主识别
file-link  任一方        服务器模式下把 R2 链接发到聊天区
```

现有 `offer/answer/ice/accept/decline/bye/ping/text/text-relay/relay*` 保留。

## 四、Durable Object 改动

1. socket attachment 增加 `{ role, admitted, device }`
2. 新 socket 默认 `admitted = false`（除建房者）
3. `peers` 广播只统计 `admitted === true`
4. 新增 `knock/admit/reject` 转发；`admit` 时把目标 socket 置为 admitted
5. 同网发现（阶段 3）另开一个 lobby DO：
   - key = `subnet:<sha256(/24 of CF-Connecting-IP)>`
   - 房间建好后向 lobby 注册 `{ code, device, ts }`
   - 同网客户端拉列表 → 点“申请加入” → 走 knock/admit

## 五、前端结构

```html
<section id="view-room">
  <header class="room-head">
    <span class="dot" id="link-dot"></span>
    <span id="link-state">等待对方</span>
    <span class="code" id="room-code">------</span>
    <button id="copy-link">复制链接</button>
    <button id="room-leave">退出</button>
  </header>

  <div class="tabs">
    <button id="room-tab-file">文件</button>
    <button id="room-tab-text">文本<i class="badge" id="chat-badge" hidden></i></button>
  </div>

  <div id="panel-file">
    <div id="file-idle">拖入或点击选择文件</div>
    <div id="file-progress">进度条 + 统计</div>
    <div id="file-ask">对方要发送 X → 接收/拒绝</div>
    <div id="file-server">直连不可用 · 上传后生成链接</div>
  </div>

  <div id="panel-text">
    <ul id="chat-list"></ul>
    <form id="chat-form"><textarea id="chat-input"></textarea><button>发送</button></form>
  </div>
</section>
```

## 六、直连失败的处理

```
watch(pc) 超时 / iceState=failed
   → 状态切 server，不跳页
   → 文件面板出现「上传并生成链接」
   → 文本面板照常可发（走 WS）
   → 同时显示「重试直连」按钮
```

不再有独立的 error 页面（只有“对方一直没来”和“房间过期”才用错误页）。

## 七、迁移顺序

1. **Step 1**：房间壳（自动建房、头部状态、双面板、文件走 P2P、文本走 P2P/WS）
2. **Step 2**：server 模式（文件上传 R2 → 链接进聊天；重试直连）
3. **Step 3**：lobby DO + knock/admit/reject + 同网列表

每步单独部署、单独验证，不回退到半成品。

## 八、测试计划

| 用例 | 验证点 |
|---|---|
| `room-e2e` 自动建房 | 打开即出码，30 秒内可用 |
| `room-e2e` 输码加入 | 对方进房，状态从 waiting → connecting → p2p |
| `room-e2e` 多批文件 | 传完一批再传一批，连接不断 |
| `room-text` 直连失败 | P2P 打死，文本仍可发（WS） |
| `room-server` 文件中转 | P2P 打死，上传后聊天区出现链接，对方可下载 |
| `room-knock` 审批 | 同网访客申请 → 房主同意/拒绝两条路径 |
| 现有 `e2e/chat-e2e/relay-ui` | 不回归 |

## 九、需要保留的旧能力

- 校验码对照（DTLS 指纹）
- 24h 自动删除 / 手动立即删除
- 分享页 `/d/<token>`
- 文本 2000 字上限、多行、IME 保护
- 进度、速度、剩余时间
