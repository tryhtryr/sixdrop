# 交接文档（2026-10-22 · UI 合并之后）

> 给下一个上下文窗口看。目标：不用重新摸索，直接接下一件事。

## 一、项目状态

**线上：<https://sixdrop.dev>**（Cloudflare Workers + Durable Objects + R2）
**仓库：<https://github.com/tryhtryr/sixdrop>**（无 LICENSE，public 但非开源）
**本地：`E:\sixdrop`**（唯一副本）

当前 HEAD：`480b1ba feat(ui): merge wait/ask/xfer/chat into one persistent room view`
（这个文档的部署记录是它之后的一个小提交）。

**线上已部署这一版**：2026-10-22，Version ID `351a3069-9377-4c45-86c8-62f138adbd49`，
`wrangler deploy` 只上传了 `index.html` / `app.js` / `style.css` 三个资产。
线上回归（e2e / chat-e2e / room-e2e）三条全过。

## 二、这一轮做了什么（UI 合并，已完成）

`view-wait` / `view-ask` / `view-xfer` / `view-chat` 四个视图已经并成一个 `view-room`：

```
┌ 房间头部：取件码  [复制取件码] [复制链接] [离开]
├ [收发文件] [发送文本]          ← 两个标签随时切，码不变
├ 文件面板：空闲（投递区 + 加入表单）/ 确认框 / 文件列表+进度
└ 文本面板：聊天
```

结构要点：

- `public/index.html`：只剩 `view-start`（首页，标签改成 `start-tab-*` / `start-panel-*` 消歧义）、
  `view-room`、`view-error`、`view-relay`
- `public/app.js`：`show()` 变成面板路由，`PANEL_OF` 把 `wait/ask/xfer/chat` 映射到房间面板：

  ```js
  const PANEL_OF = {
    wait: ['file', 'idle'],
    ask:  ['file', 'ask'],
    xfer: ['file', 'progress'],
    chat: ['text', null],
  };
  ```

  `show('room')` 只切到房间、不动面板状态；`roomTab('file'|'text')` 只切标签，**不改 `s.mode`**
  （文件会话里也能聊天）；`setFilePanel('idle'|'ask'|'progress')` 管文件面板三态
- `public/style.css`：新增 `.room-head` / `.room-code` / `.room-actions`，窄屏折行时按钮靠右

行为变化（都是房间模型要的）：

| 变化 | 说明 |
|---|---|
| 拒绝不再 `resetAll` | 只取消这一批，两边都留在原房间，换一批就能继续 |
| 取消保存对话框留在房间 | 回文件面板并在 `#wait-sub` 说明，不再重开房间 |
| 「返回」回房间不回家 | 码不变，可以直接再发一批 |
| 发送锁真正释放 | `beginSending` 用 `finally` 清 `s.sending`，第二批才发得出去 |
| 收到文本不再抢画面 | 正在等确认 / 传输中只 toast，不切面板（`s.filePanel` + `s.done` 判断） |
| 文件/文本互不干扰 | 文本面板里的消息不会把传输进度挤掉，切回来进度还在 |

### 顺手修掉的两个真 bug

1. **同一批发两遍**：`accept` 会同时从 DataChannel 和 WebSocket 到，旧代码在 `accept` 分支里
   又调一次 `beginSending()`。小文件在第二条 accept 到达前就传完了，于是整批重发一遍 ——
   接收方会在「已保存」之后又弹一次确认框。
   现在 `accept` 只认第一条：有 `acceptResolver` 就 resolve，否则只在「没在传、这批还没传完」
   （等确认超时后才点）时重开。新增 `s.batchDone` 标记。
2. **重复 offer**：`peers` 和 `peer-joined` 都会触发 `startOffer()`，会白建一条 PC/DC。
   现在 `dc.onopen` 的自动开传加了 `!s.batchDone` 判断，已经传完的一批不会因为重连再发一遍。
   （`peer-joined` 的重发 offer 逻辑保留，它是「对方刷新后重新连上」的恢复路径。）

### 删掉的东西

`tools/migrate-room.cjs`（一次性 codemod）已删除。它只对合并前的 HTML 有效，再跑会
自检失败；迁移过程留在 git 历史里。以后改房间结构直接改 HTML/JS，别再写一次性脚本。

## 三、验证过的（本地 dev-server + 真浏览器）

```bash
node test/room.test.js      # 信令 / 审批 / TTL
node test/worker.test.js    # 路由、建房、分享页
node test/relay.test.js     # R2 签名
node test/ui.test.js        # id 交叉检查、面板路由齐全、首页/房间 id 不撞车

node tools/e2e.mjs          # 3 文件传输 + 哈希 + 校验码（SIZE_MB=32 单大文件也过）
node tools/chat-e2e.mjs     # 文本链路 + 多行 + Shift+回车
node tools/room-e2e.mjs     # 房间模型验收（这一轮新增）
```

`tools/room-e2e.mjs` 覆盖：自动建房 → 标签来回切码不变 → 对方进房出确认框 →
拒绝后两边留在原房间 → 同房间第二批 → 「返回」回房间 → 第三批（验证发送锁） →
房间里互发文本 → 文本切回文件 → 离开回首页。

**注意**：`dev-server` 的 DO 是模拟的，真实信令时序只有线上能测；本地全绿不等于线上全绿。

## 四、下一步

1. ~~部署 + 线上回归~~ —— 已完成（见第一节的版本号）
2. **阶段 2：server 模式**（`docs/room-model-spec.md` 第六节）——打洞失败不跳页，
   文件面板直接给「上传并生成链接」，文本照常走 WS，再提供「重试直连」
   （现在还是独立的 `view-error` / `view-relay` 两页）
3. **阶段 3：同网发现**：后端 `knock/admit/reject` 已实现并通过测试（见 `test/room.test.js`
   「同网发现进来的访客要房主审批」），只差 lobby DO 分组 + 列表 UI
4. 二维码（分享链接已经覆盖大部分场景）

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
提交历史不回滚就不用 `wrangler rollback`；真出事时它按 Version ID 回退。

部署后必须做的回归（线上）：

```bash
BASE_URL=https://sixdrop.dev node tools/e2e.mjs
BASE_URL=https://sixdrop.dev node tools/chat-e2e.mjs
BASE_URL=https://sixdrop.dev node tools/room-e2e.mjs
```

## 七、必须知道的坑（都是真踩过的）

| 坑 | 说明 |
|---|---|
| **PowerShell 改文件会毁中文** | `Set-Content -Encoding utf8` 会加 BOM 并弄乱中文；改代码用编辑器工具或 Node 脚本，文件是 **UTF-8 无 BOM + LF** |
| **Node 不在 PATH** | 用 `C:\Users\jian\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（或先把该目录加进 PATH） |
| **`accept` 会到两次** | 信令 + DataChannel 各一条，必须幂等，否则整批发两遍 |
| **两套进入逻辑打架** | 手输码也跳 `/?c=`，否则会开出第二条 WebSocket，offer/answer 分属不同连接 |
| **`boot()` 与深链冲突** | 深链启动时设 `window.__skipBoot = true` |
| **`beginSending` 的发送锁** | 结束必须 `s.sending = false`，否则第二批发不出去（已用 `finally` 兜住） |
| **decline 不要 resetAll** | 拒绝只取消这一批，房间要留 |
| **不要把本地 dev-server 通过当生产通过** | DO 是模拟的，真实信令时序测不出来 |
| **首页和房间的 id 会撞** | 首页用 `start-tab-*` / `start-panel-*`，房间用 `tab-*` / `panel-*`；`selectTab` 限定在 `#view-start` 内 |
| **`[hidden]` 靠 CSS** | `style.css` 里 `[hidden] { display: none !important }`，别用 `display` 覆盖它 |

## 八、测试与资产

```bash
node tools/room-e2e.mjs    # 房间模型验收（合并 UI 后用这个）
node tools/e2e.mjs         # 端到端传文件；BASE_URL 指线上
node tools/chat-e2e.mjs    # 文本消息
node tools/dev-server.mjs  # 本地垫片，PORT=8787
```

- `docs/room-model-spec.md` — 房间模型的完整设计（状态机、协议、测试计划）
- `docs/competitor-report.md` — PairDrop / Snapdrop / ZWDrop 对比
- `docs/zhihu-post.md`、`docs/wechat-post.md` — 两篇现成稿子
- `C:\Users\jian\Desktop\sixdrop\` — 抖音运营资料 + 5 张图文
- 分支 `slice2-wip`、`room-wip` — 两次未完成的房间 UI 尝试，可参考（已被本轮取代）
