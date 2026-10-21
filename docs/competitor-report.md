# 三款浏览器传文件产品对比（2026-10-22）

> 依据官方 README/FAQ、GitHub API、作者发布帖与 DNS 实测；标「推测」处未获官方证实。

## PairDrop

- **定位**：Snapdrop 的活跃 fork，浏览器版 AirDrop；同网自动发现，跨网靠配对/公共房间。
- **技术**：Vanilla JS + Node/WebSocket 信令 + WebRTC；官方实例有 TURN，已配对设备跨 NAT 时自动中继；无数据库、不存文件，TURN 只转发加密流量（[README](https://github.com/schlagmichdoch/PairDrop/blob/master/README.md)、[技术文档](https://github.com/schlagmichdoch/PairDrop/blob/master/docs/technical-documentation.md)）。
- **发现**：同网自动；6 位配对码/二维码（持久设备）；5 位房间码/二维码（临时公共房间）。
- **跨网/自托管**：支持；直连优先，NAT 失败走 TURN（变慢）。需信令服务器，Docker/Node 可自托管，GPL-3.0。
- **移动/限制**：PWA，手机↔电脑；iPhone 传文件有 200MB 限制且至 2026-09 仍未解（[#294](https://github.com/schlagmichdoch/PairDrop/issues/294)）；未见断点续传；VLAN/代理下发现不稳。
- **活跃/吐槽**：11,644★，最后提交 2026-04-22（[API](https://api.github.com/repos/schlagmichdoch/PairDrop)）；槽点为设备互相看不到、跨网配对失败、TURN 慢（[#215](https://github.com/schlagmichdoch/PairDrop/issues/215)、[#130](https://github.com/schlagmichdoch/PairDrop/issues/130)、[#44](https://github.com/schlagmichdoch/PairDrop/issues/44)）。

## Snapdrop

- **定位**：鼻祖；2025 年被 LimeWire 收购，snapdrop.net 已改为云上传（免费 40GB+AI），经典版冻结。
- **技术**：Vanilla JS + Node/WebSocket + WebRTC；无 TURN；WebRTC 不可用时 WebSocket 回退、文件经服务器转发；经典版无数据库、不存文件（[README](https://github.com/SnapDrop/snapdrop/blob/master/README.md)）。
- **发现/跨网**：仅同网自动发现，无房间码/二维码；不支持跨网（[#144](https://github.com/SnapDrop/snapdrop/issues/144)）。
- **自托管/移动**：需信令服务器，Docker/Node 可自托管；移动浏览器/PWA 可用，手机↔电脑可以。
- **限制/吐槽**：无断点续传，超大文件受浏览器内存限制（推测）；VLAN/访客 Wi-Fi 发现失败；官网出售引发隐私抗议（[#651](https://github.com/SnapDrop/snapdrop/issues/651)，59👍）、宕机/连接丢失。
- **活跃**：经典库 19,718★，最后 push 2025-02-10，287 open issues/PRs，事实冻结（[API](https://api.github.com/repos/SnapDrop/snapdrop)）。
- **身份提醒**：[RobinLinus/snapdrop](https://github.com/RobinLinus/snapdrop) 现为 2026-09-15 重开的新库（36★，Rust 后端，snapdrop.me），仍是同网自动发现；经典 19.7k★ 代码在 [SnapDrop/snapdrop](https://github.com/SnapDrop/snapdrop)（Node），两者勿混。

## ZWDrop

- **定位**：2026-02 上线的国产 WebRTC 网页传输（作者 V2EX @zwplayer），聊天窗口 + 6 位房间码 + 大文件断点续传。
- **技术**：WebRTC P2P；作者称后端只做信令、文件不过服务器；IndexedDB 续传 + 流式写盘；未公开代码，未见 TURN 说明（**推测**仅 STUN，跨对称 NAT 成功率存疑）。
- **发现/跨网**：6 位数字房间码；未见局域网自动发现或二维码；宣称跨设备 P2P，跨网能力未验证。
- **自托管/移动**：需信令服务器；未开源，未查到自托管；文章给出 Android/iOS 下载路径，称 Chrome/Edge/Safari 测试通过。
- **限制/活跃**：10G+、断点续传是卖点；无公开 issue；GitHub 未查到项目、无 star；zwdrop.com/.cn 现无 A 记录，已不可访问。
- **吐槽**：上线帖即有人报「国内版国际版都打不开」，6 月又有人报「网址访问不了」（[小众软件](https://meta.appinn.net/t/topic/81499)、[V2EX](https://global.v2ex.co/t/1191969)）。

## 汇总表

| 维度 | PairDrop | Snapdrop | ZWDrop |
|---|---|---|---|
| 定位 | 活跃 fork，AirDrop 式 | 鼻祖，snapdrop.net 已云化 | 聊天式国产工具 |
| 发现 | 同网自动 + 6位配对码 + 5位房间码 + 二维码 | 仅同网自动 | 6位房间码 |
| 跨网 | 支持（TURN 兜底） | 不支持 | 宣称支持，未验证 |
| 中继/存储 | TURN 实时转发，不存 | 经典无 TURN、WS 回退不存；现 snapdrop.net 云存 40GB | 仅信令，不存（作者称） |
| 自托管 | Docker/Node | Docker/Node | 未开源，不可 |
| 移动端 | PWA，iPhone 200MB 限制 | PWA | 手机↔电脑 |
| 兼容 | 现代浏览器 | 现代浏览器；旧 iOS 走 WS 回退 | Chrome/Edge/Safari（作者称） |
| 续传/大小 | 无续传；iOS 200MB | 无续传；受内存限制 | 有续传；宣称 10G+ |
| 活跃 | 11.6k★，2026-04 | 经典 19.7k★，2025-02 冻结；新库 36★ | 无 GitHub，2026-10 失联 |

## 对比结论

**与目标定位的差异**：PairDrop 最接近，但 6 位码是持久配对，公共房间是 5 位码；跨网靠 TURN 实时中继，不是 R2 异步中转，也没有 24h 存储。Snapdrop 只同网、无码，snapdrop.net 已云化。ZWDrop 交互最像（6 位码+聊天+续传），但未开源、无 TURN 证据、现已失联。

**SixDrop 相对缺口（按你给的定位推断，未核对其功能清单）**：同网自动发现/零输入、二维码、持久设备配对、PWA/分享菜单/CLI、TURN 级低延迟兜底、多文件 ZIP、国际化。**相对多出**：6 位码直接跨网、P2P 失败可 R2 异步中转（对方离线也能取）、24h 自动删。代价是兜底路径文件经服务器，必须 E2E 加密、显式告知、删除可验证。

**值得借鉴**：PairDrop 的 6 位配对码+二维码+IndexedDB 信任、5 位房间码、TURN 自动降级、PWA/share target；ZWDrop 的聊天式 UI、IndexedDB 续传、流式写盘；Snapdrop 的极简零输入与 WebSocket 回退。
