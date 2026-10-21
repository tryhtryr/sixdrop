# 交接文档（2026-10-22）

> 给下一个上下文窗口看。目标：不用重新摸索，直接从「UI 合并」继续。

## 一、项目状态

**线上：<https://sixdrop.dev>**（Cloudflare Workers + Durable Objects + R2）
**仓库：<https://github.com/tryhtryr/sixdrop>**（无 LICENSE，public 但非开源）
**本地：`E:\sixdrop`**（唯一副本）

当前 HEAD：`94d3117 tools: room migration script with dry-run self-checks`
线上部署 = 主分支 public/ 的内容（文件列表那一版）。

## 二、线上功能（都验证过）

| 功能 | 状态 |
|---|---|
| 打开页面自动建房、立即出 6 位码 | ✅ |
| 等待页可直接选文件（对方进来自动开传） | ✅ |
| 分享链接 `/?c=CODE` 一键加入 | ✅ |
| 手输取件码加入（内部跳转 `/?c=`，同一路径） | ✅ |
| 传输界面：文件列表 + 每行独立进度条 | ✅ |
| 房间内发文本（复用同一房间，不另建） | ✅ |
| 聊天页「← 发文件」切回，码不变 | ✅ |
| 接收方拒绝 → 发送方留在房间 | ✅ |
| 取消保存对话框 → 通知对方 + 60 秒超时 | ✅ |
| accept 同时走 DataChannel（修「卡在准备中」） | ✅ |
| R2 中转兜底（打洞失败时） | ✅ 代码在，入口在失败页 |
| 校验码对照（DTLS 指纹） | ✅ |

## 三、唯一未完成的：UI 合并

### 目标

把 `view-wait` / `view-ask` / `view-xfer` / `view-chat` 四个视图合并成一个 `view-room`：

```
┌ 房间头部：取件码  [复制链接]  [离开]
├ [收发文件] [发送文本]        ← 两个标签随时切
├ 文件面板：投递区 / 确认框 / 文件列表+进度
└ 文本面板：聊天
```

### 已做好的部分

`tools/migrate-room.cjs` 脚本已经写好并通过自检：

- 默认试运行，`--apply` 才写入
- 先给首页的 `tab-file/tab-text/panel-file/panel-text` 改名成 `start-*`（消除 id 冲突）
- 按 section 边界切分，不靠 class 正则
- 重写 `show()` 为面板路由：

```js
const PANEL_OF = {
  wait: ['file', 'idle'],
  ask:  ['file', 'ask'],
  xfer: ['file', 'progress'],
  chat: ['text', null],
};
```

- 写入前自检：id 无重复、JS 引用的 id 都存在，不满足就拒绝写入

### 卡在哪

`--apply` 写入成功、语法检查通过、自检全绿，但**运行时**接收方等不到 `#file-ask` 面板。

排查方向（下一轮从这里开始）：

1. 在 `show()` 里打日志，确认 `askToReceive()` 触发时 `show('ask')` 有没有执行
2. 检查 `roomSelectTab()` 是否因为 `$('room-tab-file')` 为 null 提前 return
3. 检查 `setFilePanel('ask')` 之后 `#panel-file` 是否被 `selectTab` 重新隐藏
4. 确认 `s.mode === 'text'` 的分支没有把面板切走

### 恢复方式

```bash
cd E:\sixdrop
git checkout -- public/index.html public/app.js tools/e2e.mjs
```

## 四、必须知道的坑（都是真踩过的）

| 坑 | 说明 |
|---|---|
| **PowerShell 改文件会毁中文** | `Set-Content -Encoding utf8` 会加 BOM 并弄乱中文；改代码一律用 **Node 脚本** |
| **两套进入逻辑打架** | 页面已自动建房时，再手输码会开出第二条 WebSocket，offer/answer 分属不同连接，永远连不上。解法：手输码也跳 `/?c=` |
| **`boot()` 与深链冲突** | 深链启动时要设 `window.__skipBoot = true`，否则 boot 会重置刚建立的会话 |
| **`beginSending` 的发送锁** | 结束后必须 `s.sending = false`，否则第二批发不出去 |
| **decline 不要 resetAll** | 拒绝只取消这一批，房间要留 |
| **accept 只走信令会丢** | 用户选保存位置的几秒里信令可能断，accept 要同时从 DataChannel 发 |
| **不要把本地 dev-server 通过当生产通过** | dev-server 的 DO 是模拟的，真实信令时序问题测不出来 |

## 五、性能数据（已实测，别再重复测）

| 场景 | 速度 |
|---|---|
| 手机 → 电脑（Wi-Fi 6） | 17–19 MB/s，417 MB 约 22 秒 |
| 电脑 → 电脑（千兆有线） | 39 MB/s 平均，峰值 45–50 |
| 纯 HTTP 对照（同一网络） | 113 MB/s |

**手机是瓶颈**（Chrome Android 的 DataChannel 实现），不是 WebRTC 整体。多通道并行无收益（1/2/4/8 条都是 ~16 MB/s）。

## 六、测试

```bash
npm test              # 4 个单元测试文件
node tools/e2e.mjs    # 端到端传文件（生产可用 BASE_URL 指向线上）
node tools/chat-e2e.mjs
node tools/room-e2e.mjs   # 房间模型验收（合并 UI 后用它）
```

**每次改动后必须在生产上跑 e2e**，不能只看本地。

## 七、其他资产

- `docs/room-model-spec.md` — 房间模型的完整设计（状态机、协议、测试计划）
- `docs/competitor-report.md` — PairDrop / Snapdrop / ZWDrop 对比
- `docs/zhihu-post.md`、`docs/wechat-post.md` — 已写好的两篇稿子
- `C:\Users\jian\Desktop\sixdrop\` — 抖音运营资料 + 5 张图文（数据是实测的）
- 分支 `slice2-wip`、`room-wip` — 两次未完成的房间 UI 尝试，可参考

## 八、下一步建议顺序

1. **修完 UI 合并**（本文第三节的排查方向）
2. **同网自动发现**：后端审批协议（`knock/admit/reject`）已实现并通过测试，只需加 lobby DO 分组和列表 UI
3. 二维码（分享链接已经覆盖大部分场景）

不要做的事：断点续传（工作量大、半吊子没价值）、TURN 中继（成本）、继续调传输参数（已到头）。
