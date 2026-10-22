# 交接文档（2026-10-22 · 大厅 + 房间 + 同网发现）

> 给下一个上下文窗口看。目标：不用重新摸索，直接接下一件事。

## 一、项目状态

**线上：<https://sixdrop.dev>**（Cloudflare Workers + Durable Objects + R2）
**仓库：<https://github.com/tryhtryr/sixdrop>**（无 LICENSE，public 但非开源）
**本地：`E:\sixdrop`**（唯一副本）

当前 HEAD：`fix(lobby): only advertise the room after the signalling socket is up` 之后的小提交
（见 `git log`）。

**线上已部署这一版**：2026-10-22，Version ID `36adc350-0598-43fe-b0a2-959dfba66475`，
`env.LOBBY (Lobby)` 绑定（wrangler migration v3）。线上回归 4 条全过
（e2e / chat-e2e / room-e2e / discover-e2e）。

**注意**：本地 `main` 和 `origin/main` 已经分叉（远端还停在 slice2 那几次提交），
本地这台机器的部署就是从本地目录 `wrangler deploy` 的，所以**线上对应当前本地工作树**。

## 二、当前界面结构（大厅 + 房间）

**大厅**（`view-lobby`，打开页面就是它）：取件码和同网设备**同时在场**（这一版按用户反馈，
从 PairDrop 的「设备优先」改回了「码 + 设备一起显示」）。

```
┌ [有人敲门：某某 想加入你的房间  [同意][拒绝]]   ← 只在有人申请时出现
│ 把这串取件码发给对方，对方输入就能进来
│            A B C 1 2 3
│  [复制取件码]   [复制链接]
│  ─────────────── 或 ───────────────
│  输入对方的取件码
│  [ 6 位取件码          ] [加入]
│        对方会看到你叫 温柔的狐狸  改名
│        同一网络可见：开
│  ───────────── 同一网络 ─────────────
│  [💻] 小李的 iPhone   Windows · Edge   刚刚  [申请加入]
│  [💻] 勇敢的松鼠      Windows · Edge   刚刚  [申请加入]
│  （没设备时：同一网络里还没发现设备… + 刷新 / 网络诊断）
└
```

**房间**（`view-room`）：输码进来（或对方输你的码 / 同网被同意）之后才有。

```
┌ 取件码 ABC123                    [离开]
├ [收发文件] [消息]             ← 两个标签随时切，码不变
├ 文件面板：空闲（状态行 + 投递区）/ 确认框 / 文件列表+进度
└ 文本面板：聊天
```

进出房间的规则：

| 事件 | 结果 |
|---|---|
| 打开页面 | 建房拿码，停在大厅（`show('lobby')`）；**WS `joined` 之后**才登记到同网大厅并开始轮询 |
| 点同网设备行的「申请加入」 | 换一次性 invite → 跳 `/?invite=…` → 换码时校验房主在线 → 连 `via=discover`（pending） |
| 房主点「同意」 | 访客被 admit，两边进同一个房间；房主进房间时撤销自己的登记 |
| 房主点「拒绝」 | 访客收到 reject，回大厅重新开一间 |
| 输入取件码 | 跳 `/?c=CODE`，直接进房间（`startReceive()`） |
| 对方输码进房（`peers` n≥2） | 房主自动进房间（`enterRoom()`），码不变 |
| 点「离开」 | `leaveRoom()`：发 bye → 撤销登记 → 回大厅并**换一个新码** |
| 传完点「返回」 | `show('room')`，回房间文件面板，码不变 |

大厅的 UI 元素：`#lobby-code`（取件码）、`#copy`/`#copy-link`、`#join`/`#code`、
`#self-name` + `#rename`（对方看到的名字，可改）、`#discover-toggle`（同网可见开关）、
`#discover` 里的 `#lobby-list`（行式：图标 + 名字 + 平台 + 多久之前 + 申请加入）、
`#lobby-empty`（空状态）、`#lobby-actions`（`#lobby-refresh` / `#lobby-diag`）、
`#knock`（房主审批条）。

### 同网发现（阶段 3，已上线）

- **分组键**：出口 IP（IPv4 精确、IPv6 `/64`），加盐 SHA-256 + `LOBBY_VERSION` 当大厅
  DO 的名字（`src/worker.js` 的 `subnetKey()`）。本地没有 `CF-Connecting-IP`，
  统一按 `dev` 分组 → 本机所有页面天然同网。
  （曾做过一版「同一网络房间」按名字分组，用户要求去掉，已删除；双 WAN 网络就改用取件码/链接。）
- **名字**：每台设备本地随机一个「形容词 + 动物」（`sixdrop.name`），可改名；
  平台（`Android · Edge` 这种）只做副标题，识别靠名字。**Android Edge 的 UA 是 `EdgA/`**，
  已经单独匹配（之前被识别成 Chrome）。
- **存储**：`src/lobby.js`，只存 `{ id, code, name, platform, ts }`；对外只给
  `id / name / platform / age`，**取件码从来不进列表**。条目 3 分钟不续期就过期
  （前端在大厅每 20 秒心跳续期）。
- **加入**：`POST /api/lobby/invite {id}` 换 12 位一次性 token（60 秒有效、只能用一次），
  页面拿 token 换回码后才连房间，连接带 `via=discover` → 房间侧 `admitted=false`，
  只允许发 `knock`，房主 `admit` 之后才转发信令（这套在 `src/room.js`，本来就有测试）。
- **网络诊断**：`GET /api/lobby/whoami` 回 `{ tag, family }`（短哈希 + IPv4/IPv6）。
  大厅空状态会**自动**把「网络组 · 地址族」显示出来（两台一对就知道是不是同一个出口），
  不用手动点「网络诊断」。两台设备 tag 一样才可能互相发现；**IPv4 和 IPv6 是两组，
  永远互相看不到**（浏览器拿不到局域网网段，也没法强制协议族），这种情况用取件码/链接。
  手机用流量也会换组。
- **幽灵条目**：大厅条目 3 分钟过期，但房主一断线（关页面、强杀、切网）房间那边就会
  用 `seat`（Worker 算好的大厅 key，通过 `/ws` 传进来）让 LOBBY 把条目 hide 掉，
  所以正常情况下列表是干净的（实测硬杀 context 后 ~5 秒内消失，也就是下一次轮询）。
  兜底还有两道：`/api/invite/<token>` 换码时会问 `/alive`，没有 sender 就 404 `host-left`；
  房间 upgrade 时没有房主也会直接 reject。
- **可见性**：默认开，开关在 `localStorage['sixdrop.discover']`；关掉立刻 `POST /api/lobby/hide`。
  关页面用 `sendBeacon` 撤销（撤不掉也会 3 分钟过期）。
- **路由**：`GET /api/lobby`、`POST /api/lobby/register`、`POST /api/lobby/hide`、
  `POST /api/lobby/invite`、`GET /api/invite/<token>`。
- **限制**：列表最多 20 条；每个房间同时只有一个 pending 访客（房间只有 receiver 一个槽）；
  进了房间就不再可被发现（v1 刻意不做房间内审批）。
- **已知取舍**：审批是"软门槛"——申请方拿到码后理论上可以直接 `/?c=` 绕过审批；
  列表不广播码、审批拦住顺手乱点，但挡不住同网的有心人。手机流量/CGNAT 下会看到同出口的陌生人。

### 代码结构

- `public/index.html`：`view-lobby`（大厅）、`view-room`（房间）、`view-error`、`view-relay`
- `public/app.js`：`show()` 是面板路由，`PANEL_OF` 把 `wait/ask/xfer/chat` 映射到房间面板：

  ```js
  const PANEL_OF = {
    wait: ['file', 'idle'],
    ask:  ['file', 'ask'],
    xfer: ['file', 'progress'],
    chat: ['text', null],
  };
  ```

  - `show('room')` 只切到房间、不动面板状态
  - `roomTab('file'|'text')` 只切标签，**不改 `s.mode`**（文件会话里也能聊天）
  - `setFilePanel('idle'|'ask'|'progress')` 管文件面板三态
  - `setStatus()` 写文件面板顶部状态行 `#room-status`
  - `setCode()` 同时更新大厅 `#lobby-code` 和房间头部 `#room-code`
  - `takeFiles()` 是房间里选文件的唯一入口（点选择框或拖进 `.drop`）
  - 同网发现：`deviceLabel()` / `discoverOn()` / `registerSelf()` / `unregisterSelf()` /
    `startLobbyPoll()` / `refreshLobbyList()` / `renderLobbyList()` / `requestJoin()` /
    `onKnock()` / `giveUpOnApproval()`
- `public/style.css`：`.room-head` / `.room-code` / `.or` / `.lobby-list` / `.knock`

### 行为细节

| 变化 | 说明 |
|---|---|
| 选文件在房间里 | 大厅不再有投递区；`#file-wait` / `.drop` 在房间文件面板 |
| 没有「只发文本」入口了 | 文本就是房间的第二个标签，同一条 DataChannel |
| 拒绝不 `resetAll` | 只取消这一批，两边都留在原房间，换一批就能继续 |
| 取消保存对话框留在房间 | 回文件面板并写状态行，不再重开房间 |
| 「返回」回房间不回大厅 | 码不变，可以直接再发一批 |
| 发送锁真正释放 | `beginSending` 用 `finally` 清 `s.sending`，第二批才发得出去 |
| 收到文本不抢画面 | 只要没在看文本面板，就来消息时点亮「消息」上的未读灯（`#chat-badge`）+ toast；**不自动切面板**，切到文本面板时清灯 |

标签任何时候都能切，**传输中切到文本聊天不影响传输**（两边都验证过：接收中、发送中、确认框等待时都能切，
传完仍停在文本面板）。未读灯在「闲在文件面板」和「正在传文件」两种情况下都会亮。

### 顺手修掉的两个真 bug

1. **同一批发两遍**：`accept` 会同时从 DataChannel 和 WebSocket 到，旧代码在 `accept` 分支里
   又调一次 `beginSending()`。小文件在第二条 accept 到达前就传完了，于是整批重发一遍 ——
   接收方会在「已保存」之后又弹一次确认框。
   现在 `accept` 只认第一条：有 `acceptResolver` 就 resolve，否则只在「没在传、这批还没传完」
   （等确认超时后才点）时重开。新增 `s.batchDone` 标记。
2. **重复 offer**：`peers` 和 `peer-joined` 都会触发 `startOffer()`，会白建一条 PC/DC。
   现在 `dc.onopen` 的自动开传加了 `!s.batchDone` 判断，已经传完的一批不会因为重连再发一遍。
   （`peer-joined` 的重发 offer 逻辑保留，它是「对方刷新后重新连上」的恢复路径。）
3. **未准入的访客被当成了对端**（做同网发现时暴露的）：`Room.upgrade` 以前不管有没有
   admitted 都广播 `peer-joined`，房主会在客人还没被同意时就被拉进房间（然后自动拒掉客人）。
   现在只有 `admitted` 的连接才通知对端；`peerGone` 的 `peers` 数也改成只数 admitted。

### 删掉的东西

- `tools/migrate-room.cjs`（一次性 codemod）已删除，迁移过程留在 git 历史里。
- 首页的「发送文件 / 发送文本」两个标签、首页投递区、`startTextChat()` 都删了：
  文本不再是独立会话，只是房间里的一个标签。`s.mode` 平时只剩 `'file'`
  （`'text'` 分支留给阶段 2 的服务器转发）。

## 三、验证过的（本地 dev-server + 真浏览器）

```bash
node test/room.test.js      # 信令 / 审批 / TTL
node test/worker.test.js    # 路由、建房、分享页
node test/relay.test.js     # R2 签名
node test/lobby.test.js     # 大厅：注册/列表/过期/invite 一次性/上限/hide
node test/ui.test.js        # id 交叉检查、面板路由、大厅/房间的结构约束

node tools/e2e.mjs          # 3 文件传输 + 哈希 + 校验码（SIZE_MB=32 单大文件也过）
node tools/chat-e2e.mjs     # 房间里的文本链路 + 多行 + Shift+回车
node tools/room-e2e.mjs     # 大厅/房间模型验收（主验收）
node tools/discover-e2e.mjs # 同网发现验收
```

`tools/room-e2e.mjs` 覆盖：打开只有取件码 → 输码进房间 → 房主自动进房间 → 直连建立 →
两个标签来回切 → 拒绝后两边留在原房间 → 同房间第二批 → 「返回」回房间 →
第三批（验证发送锁）→ **接收中收到消息只亮未读点、切过去能看且文件仍完整** →
房间里互发文本 → 文本切回文件 → 离开回大厅拿新码。

`tools/discover-e2e.mjs` 覆盖：两台互相发现 → 申请（房主不会被提前拉进房间）→ 同意 →
进同一个房间 → 传文件哈希一致 → 进房间后从列表消失 → 离开后重新可见 →
拒绝后申请方回大厅 → 关掉可见性后立刻从别人列表消失、再打开又出现。
（设备名每次跑带随机后缀，避免和上一轮残留条目撞名。）

**注意**：`dev-server` 的 DO 是模拟的，真实信令时序只有线上能测；本地全绿不等于线上全绿。

## 四、下一步

1. **阶段 2：server 模式**（`docs/room-model-spec.md` 第六节）——打洞失败不跳页，
   房间文件面板直接给「上传并生成链接」，文本照常走 WS，再提供「重试直连」
   （现在还是独立的 `view-error` / `view-relay` 两页）
2. 同网发现的 v1.1（可选）：房间内也能接申请、给设备起昵称、从列表直接看房间 "已经传过几批"。
3. 二维码（分享链接已经覆盖大部分场景）

不要做的事：断点续传、TURN 中继、继续调传输参数（都已评估过，见第五、七节）。

## 五、性能数据（已实测，别再重复测）

| 场景 | 速度 |
|---|---|
| 手机 → 电脑（Wi-Fi 6） | 17–19 MB/s，417 MB 约 22 秒 |
| 电脑 → 电脑（千兆有线） | 39 MB/s 平均，峰值 45–50 |
| 纯 HTTP 对照（同一网络） | 113 MB/s |

手机是瓶颈（Chrome Android 的 DataChannel 实现），不是 WebRTC 整体。多通道并行无收益。

## 六、部署

```bash
cd E:\sixdrop
npx wrangler deploy        # 线上 = 主分支 public/ 的内容
```

本机没有全局 `npm`/`npx`，实际可用的写法：

```powershell
$env:PATH = "C:\Users\jian\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin;" + $env:PATH
cd E:\sixdrop
node node_modules\wrangler\bin\wrangler.js deploy
```

认证信息在 `%APPDATA%\xdg.config\.wrangler\config\default.toml`（wrangler 4 的位置）。
真出事时 `wrangler rollback` 可以按 Version ID 回退（`wrangler deployments list` 查）。

部署后必须做的回归（线上）：

```bash
BASE_URL=https://sixdrop.dev node tools/e2e.mjs
BASE_URL=https://sixdrop.dev node tools/chat-e2e.mjs
BASE_URL=https://sixdrop.dev node tools/room-e2e.mjs
BASE_URL=https://sixdrop.dev node tools/discover-e2e.mjs
```

新增 Durable Object 类（这次是 `Lobby`）必须同时改 `wrangler.jsonc` 的 `migrations`
（`{ "tag": "v3", "new_sqlite_classes": ["Lobby"] }`），否则 deploy 会报迁移不一致。
可选密钥：`npx wrangler secret put SUBNET_SALT`（改分组盐，不设就用内置常量）。

## 七、必须知道的坑（都是真踩过的）

| 坑 | 说明 |
|---|---|
| **PowerShell 改文件会毁中文** | `Set-Content -Encoding utf8` 会加 BOM 并弄乱中文；改代码用编辑器工具或 Node 脚本，文件是 **UTF-8 无 BOM + LF** |
| **Node 不在 PATH** | 用 `C:\Users\jian\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（或先把该目录加进 PATH） |
| **`accept` 会到两次** | 信令 + DataChannel 各一条，必须幂等，否则整批发两遍 |
| **两套进入逻辑打架** | 手输码也跳 `/?c=`，否则会开出第二条 WebSocket，offer/answer 分属不同连接 |
| **`boot()` 与深链冲突** | 深链启动时设 `window.__skipBoot = true`；`leaveRoom()` 里要把它清回去，否则离开后建不了房 |
| **`beginSending` 的发送锁** | 结束必须 `s.sending = false`，否则第二批发不出去（已用 `finally` 兜住） |
| **decline 不要 resetAll** | 拒绝只取消这一批，房间要留 |
| **不要把本地 dev-server 通过当生产通过** | DO 是模拟的，真实信令时序测不出来 |
| **大厅和房间会有同名需求** | 码分两个 id：`#lobby-code`（大号）和 `#room-code`（房间头部）；写码统一走 `setCode()` |
| **访客不能撤销房主的登记** | `registerSelf()` / `unregisterSelf()` / `pagehide` 都先判 `s.role === 'sender'`；访客手里的 `s.code` 是房主的码 |
| **未准入的连接不能广播 peer-joined** | 否则房主在审批前就被拉进房间，然后自动拒掉客人（已修） |
| **邀请是一次性的** | `GET /api/invite/<token>` 换过就删；页面刷新后要重新申请 |
| **同网列表有 3 分钟有效期** | 前端在大厅每 20 秒心跳续期；关页面用 `sendBeacon` 撤销。测试里用带随机后缀的设备名，别和残留条目撞名 |
| **Durable Object 不随 deploy 立刻换代码** | 已活着的 DO 实例会继续跑旧代码（这次给 Lobby 的 invite 响应加 `code` 就踩了：Worker 拿到 undefined，全被当成 ghost）。要么等它被驱逐，要么别让新代码依赖旧的 DO 响应字段。大厅的响应字段一改，就把 `src/worker.js` 里的 `LOBBY_VERSION` +1，等于换一批全新的 DO 实例 |
| **大厅的字段契约由 Worker 兜住** | `listLobby()` 会把旧实例的 `device` 归一成 `name`，`register` 同时发 `name` 和 `device`；这样新旧 Lobby 实例混着跑也不会出现「未知设备」 |
| **IPv4 / IPv6 是两个大厅** | 分组键按地址族分开：一台走 v4、一台走 v6 永远互相看不到（浏览器里没法强制协议族）。大厅的「网络诊断」显示网络组和地址族，两台对不上就用取件码 |
| **双 WAN 的网络下 IP 分组不可靠** | 出口是 mwan3 按连接 48:52 分流的，同一台设备两次请求都可能落到不同运营商（实测同一台机器：`whoami` 一会 `IPv6 75771764`、一会 `IPv4 d957f1cf`）；桌面还接了另一条线时更是完全不同的出口。这种网络自动发现不可靠，用取件码/链接 |
| **大厅条目要等 WS 连上才登记** | 否则别人点进来时 `/alive` 还查不到 sender，一拍就被当成 ghost 撤掉（生产上抓到过一次竞态） |
| **`[hidden]` 靠 CSS** | `style.css` 里 `[hidden] { display: none !important }`，别用 `display` 覆盖它 |

## 八、测试与资产

```bash
node tools/room-e2e.mjs     # 大厅/房间验收（主验收）
node tools/discover-e2e.mjs # 同网发现验收
node tools/e2e.mjs          # 端到端传文件；BASE_URL 指线上
node tools/chat-e2e.mjs     # 房间里的文本消息
node tools/dev-server.mjs   # 本地垫片，PORT=8787（含 LOBBY 的垫片）
```

- `docs/room-model-spec.md` — 房间模型的完整设计（状态机、协议、测试计划）
- `docs/competitor-report.md` — PairDrop / Snapdrop / ZWDrop 对比
- `docs/zhihu-post.md`、`docs/wechat-post.md` — 两篇现成稿子
- `C:\Users\jian\Desktop\sixdrop\` — 抖音运营资料 + 5 张图文
- `tools/preview-home.mjs` — 重新生成 `public/logo/preview-home.png`（大厅截图，改了界面就跑一次）
- 分支 `slice2-wip`、`room-wip` — 两次未完成的房间 UI 尝试，可参考（已被本轮取代）
