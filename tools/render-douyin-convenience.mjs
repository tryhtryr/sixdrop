/**
 * 抖音图文素材渲染（便利向，不做"不限速"承诺）
 *   node tools/render-douyin-convenience.mjs
 *
 * 输出到 C:\Users\jian\Desktop\sixdrop\01..03\*.png（1200×1600，3:4）
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = 'C:\\Users\\jian\\Desktop\\sixdrop';

const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const icon = (await readFile(`${ROOT}public/icon.svg`, 'utf8')).replace(/^\uFEFF/, '').trimStart();

// 大图标去掉自带的方块底，只留六边形 + 箭头（否则在深色卡上是一个黑方块）
const mark = icon
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<rect\s+width="64"\s+height="64"[^>]*\/>/, '');

/* ---------------- 版面 ---------------- */

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:1600px;overflow:hidden}
body{position:relative;background:#0a0e15;color:#eef2f8;
     font-family:"Segoe UI","Microsoft YaHei",sans-serif;padding:84px 88px;
     display:flex;flex-direction:column}
.glow{position:absolute;inset:0;
      background:radial-gradient(920px 800px at 28% 8%, #16253c 0%, #0c1220 54%, #080b11 100%)}
.dots{position:absolute;inset:0;opacity:.22;
      background-image:radial-gradient(rgba(120,160,220,.14) 1px, transparent 1px);
      background-size:36px 36px}
.top{position:relative;display:flex;align-items:center;gap:14px}
.top svg{width:46px;height:46px;display:block}
.top .nm{font-size:24px;font-weight:700;color:#c3d0e2}
.top .env{margin-left:auto;font-size:20px;color:#6c7f99;letter-spacing:.08em}
.main{position:relative;flex:1;display:flex;flex-direction:column;min-height:0;justify-content:center}
.kicker{margin-top:52px;font-size:26px;letter-spacing:.26em;color:#5f708a}
h1{font-size:104px;line-height:1.16;font-weight:800;letter-spacing:-.02em}
h1 em{font-style:normal;color:#5b95ff}
h2{font-size:74px;line-height:1.22;font-weight:800;letter-spacing:-.02em}
h2 em{font-style:normal;color:#6fe0c8}
.sub{font-size:36px;line-height:1.55;color:#a3b4cb}
.lead{font-size:34px;line-height:1.68;color:#b7c6da}
.lead b{color:#7fb4ff}
/* 步骤 */
.steps{margin-top:46px;display:flex;flex-direction:column;gap:26px}
.step{display:flex;gap:26px;align-items:flex-start;
      padding:26px 28px;border-radius:20px;background:rgba(255,255,255,.026);
      border:1px solid #1c2738}
.step .n{flex:0 0 74px;height:74px;border-radius:50%;display:grid;place-items:center;
         font-size:34px;font-weight:800;color:#bfe2ff;
         background:linear-gradient(180deg,rgba(79,140,255,.28),rgba(79,140,255,.10));
         border:1px solid #2b4f7f}
.step .t{font-size:38px;font-weight:700;line-height:1.35}
.step .d{margin-top:8px;font-size:27px;line-height:1.5;color:#8fa2ba}
/* 对比两栏 */
.cmp{margin-top:44px;display:flex;gap:26px}
.col{flex:1;padding:34px 30px;border-radius:22px;border:1px solid #212c3d;background:rgba(255,255,255,.02)}
.col.now{border-color:#24426b;background:linear-gradient(160deg,rgba(79,140,255,.12),rgba(111,224,200,.06))}
.col h3{font-size:30px;font-weight:700;color:#93a6be;letter-spacing:.06em}
.col.now h3{color:#9fc6ff}
.col ul{margin-top:22px;list-style:none;display:flex;flex-direction:column;gap:20px}
.col li{font-size:30px;line-height:1.45;color:#c6d3e4;padding-left:26px;position:relative}
.col li::before{content:"";position:absolute;left:0;top:14px;width:10px;height:10px;border-radius:50%;
                background:#3d5573}
.col.now li::before{background:#5b95ff}
/* 列表 */
.list{margin-top:44px;display:flex;flex-direction:column;gap:24px}
.item{display:flex;gap:24px;align-items:flex-start;padding-bottom:22px;border-bottom:1px solid #182233}
.item:last-child{border-bottom:0;padding-bottom:0}
.item .k{flex:0 0 74px;font-size:42px;font-weight:800;color:#5b95ff;line-height:1.1}
.item .b{flex:1;min-width:0}
.item .t{font-size:37px;font-weight:700;line-height:1.35}
.item .d{margin-top:8px;font-size:27px;line-height:1.55;color:#8fa2ba}
/* 底部 */
.foot{position:relative;margin-top:44px;padding-top:34px;border-top:1px solid #1b2536;
      font-size:26px;color:#7c8ea6;line-height:1.6}
.foot b{color:#a9c6ff}
.tag{position:absolute;right:88px;bottom:44px;font-size:20px;color:#4f627e;letter-spacing:.2em}
/* 封面 / 结尾 */
.cover{justify-content:center}
.cover .badge{display:inline-flex;align-items:center;gap:12px;padding:10px 20px;border-radius:999px;
      font-size:23px;color:#9fb6d6;background:rgba(79,140,255,.10);border:1px solid #234067;
      align-self:flex-start}
.cover h1{margin-top:44px}
.cover .sub{margin-top:34px;max-width:960px}
.cover .bar{margin-top:52px;width:132px;height:7px;border-radius:4px;
      background:linear-gradient(90deg,#4f8cff,#6fe0c8)}
.end{align-items:center;justify-content:center;text-align:center}
.end svg.mark{width:200px;height:200px;filter:drop-shadow(0 26px 60px rgba(79,140,255,.42))}
.end h2{margin-top:44px}
.end .lead{margin-top:28px}
.end .how{margin-top:52px;padding:34px 40px;border-radius:20px;background:rgba(255,255,255,.03);
      border:1px solid #223148;font-size:32px;line-height:1.7;color:#c9d7ea}
.end .how b{color:#7fb4ff}
`;

const shell = (cls, inner, tag) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body>
  <div class="glow"></div><div class="dots"></div>
  <div class="top">${icon}<div class="nm">SixDrop</div><div class="env">${tag.env || ''}</div></div>
  <div class="main ${cls}">${inner}</div>
  <div class="tag">${tag.page}</div>
</body></html>`;

const cover = ({ badge, title, sub, page, env }) =>
  shell(
    'cover',
    `<div class="badge">${badge}</div>
     <h1>${title}</h1>
     <div class="sub">${sub}</div>
     <div class="bar"></div>`,
    { page, env },
  );

const steps = ({ kicker, title, items, page, env, foot }) =>
  shell(
    '',
    `<div class="kicker">${kicker}</div>
     <h2>${title}</h2>
     <div class="steps">
       ${items
         .map(
           (it) => `<div class="step"><div class="n">${it.n}</div>
         <div><div class="t">${it.t}</div>${it.d ? `<div class="d">${it.d}</div>` : ''}</div></div>`,
         )
         .join('')}
     </div>
     ${foot ? `<div class="foot">${foot}</div>` : ''}`,
    { page, env },
  );

const compare = ({ kicker, title, left, right, foot, page, env }) =>
  shell(
    '',
    `<div class="kicker">${kicker}</div>
     <h2>${title}</h2>
     <div class="cmp">
       <div class="col"><h3>${left.head}</h3><ul>${left.items.map((i) => `<li>${i}</li>`).join('')}</ul></div>
       <div class="col now"><h3>${right.head}</h3><ul>${right.items.map((i) => `<li>${i}</li>`).join('')}</ul></div>
     </div>
     ${foot ? `<div class="foot">${foot}</div>` : ''}`,
    { page, env },
  );

const list = ({ kicker, title, items, foot, page, env }) =>
  shell(
    '',
    `<div class="kicker">${kicker}</div>
     <h2>${title}</h2>
     <div class="list">
       ${items
         .map(
           (it) => `<div class="item"><div class="k">${it.k || '·'}</div>
         <div class="b"><div class="t">${it.t}</div>${it.d ? `<div class="d">${it.d}</div>` : ''}</div></div>`,
         )
         .join('')}
     </div>
     ${foot ? `<div class="foot">${foot}</div>` : ''}`,
    { page, env },
  );

const end = ({ title, lead, how, page, env }) =>
  shell(
    'end',
    `<svg class="mark" viewBox="0 0 64 64">${mark}</svg>
     <h2>${title}</h2>
     <div class="lead">${lead}</div>
     <div class="how">${how}</div>`,
    { page, env },
  );

/* ---------------- 三条选题的脚本 ---------------- */

const TOPICS = [
  {
    dir: '01-选题1-不用装App',
    cards: [
      ['01-cover.png', cover({
        badge: '工具 · 效率',
        title: '发个文件<br />为什么<em>非要装个 App</em>？',
        sub: '打开网页 → 把 6 位码给对方 → 传完。<br />不用注册，也不用加好友。',
        page: '01 / 06',
        env: '不用装 App',
      })],
      ['02-steps.png', steps({
        kicker: '流程',
        title: '4 步，先把它发出去',
        items: [
          { n: '1', t: '两边都打开 127.0.0.1:8787', d: '电脑、手机都行；不下载、不安装、不注册' },
          { n: '2', t: '同一个网络：直接看见对方', d: '大厅里点对方的设备，对方点「同意」，一起进房间' },
          { n: '3', t: '不在同一网络：发 6 位取件码', d: '对方输码进来，或者直接点你复制的链接' },
          { n: '4', t: '选文件，对方自己选保存位置', d: '可多选；文件是直接传过去的，不是先传上网盘' },
        ],
        page: '02 / 06',
        env: '4 步',
      })],
      ['03-compare.png', compare({
        kicker: '对比',
        title: '省掉的是<em>这几步</em>',
        left: { head: '网盘 / 聊天工具', items: ['先装个 App', '注册 + 登录', '上传完，再发给对方', '等对方慢慢下'] },
        right: { head: 'SixDrop', items: ['打开网页', '输码，或者点一下设备', '直接传到对方设备', '传完还能接着聊'] },
        foot: '直连时<b>文件不经过服务器</b>；唯一的代价是两边都得在线。',
        page: '03 / 06',
        env: '少 4 步',
      })],
      ['04-two-ways.png', list({
        kicker: '入口',
        title: '两个入口，按场景选',
        items: [
          { k: '①', t: '同一个网络', d: '打开就互相看见，点设备 → 对方同意 → 进同一个房间' },
          { k: '②', t: '不在同一个网络', d: '复制链接或报 6 位取件码，对方输码就进' },
          { k: '③', t: '双 WAN / 多出口的网络', d: '自动发现可能对不上（出口 IP 会变），直接用取件码最稳' },
        ],
        foot: '大厅里会显示当前的「网络组」，两台对不上就说明走的不是同一个出口。',
        page: '04 / 06',
        env: '两个入口',
      })],
      ['05-room.png', list({
        kicker: '之后',
        title: '传完不用退出房间',
        items: [
          { k: '·', t: '再发一批', d: '房间和码都没变，直接选下一批文件' },
          { k: '·', t: '顺手说句话', d: '切到「消息」，文字走同一条连接，不用另开聊天' },
          { k: '·', t: '关掉就散了', d: '不建账号、不留历史；下次重新开一个房间' },
        ],
        foot: '同一个房间从头用到尾，不用每传一次就重新约一次。',
        page: '05 / 06',
        env: '房间常驻',
      })],
      ['06-end.png', end({
        title: '不装、不注册、不排队',
        lead: '能用浏览器解决的事，<br />就别再装一个 App 了。',
        how: '搜 <b>SixDrop</b>，或直接输 <b>127.0.0.1:8787</b><br />6 位取件码 · 点对点直传',
        page: '06 / 06',
        env: 'SixDrop',
      })],
    ],
  },
  {
    dir: '02-选题2-三个临时场景',
    cards: [
      ['01-cover.png', cover({
        badge: '场景 · 日常',
        title: '临时传一下，<br />还要<em>找数据线</em>？',
        sub: '手机照片给电脑、给同事传安装包、跨城给家人：<br />三个场景，一个网页解决。',
        page: '01 / 06',
        env: '3 个场景',
      })],
      ['02-scene-phone.png', steps({
        kicker: '场景一',
        title: '手机里的照片、视频，\n挪到电脑上',
        items: [
          { n: '1', t: '两台连同一个 Wi-Fi，都打开 127.0.0.1:8787', d: '手机浏览器就行，不用装客户端' },
          { n: '2', t: '电脑上会直接出现你的手机', d: '点「申请加入」，手机上点「同意」' },
          { n: '3', t: '手机选照片，电脑选保存位置', d: '原图原视频直接过去，不压缩、不转码' },
        ],
        page: '02 / 06',
        env: '同一 Wi-Fi',
      })],
      ['03-scene-office.png', steps({
        kicker: '场景二',
        title: '给同事传个安装包，\n不想发群',
        items: [
          { n: '1', t: '同一个办公室、同一个网络', d: '大厅里互相能看见，不用先加好友' },
          { n: '2', t: '点对方设备，对方点「同意」', d: '两边进同一个房间' },
          { n: '3', t: '选文件（可多选），对方选个文件夹', d: '压缩包、镜像、素材，全自动存进去' },
        ],
        foot: '注意：接收端浏览器不支持流式写盘时（Firefox / Safari），单文件建议别超过 1 GB。',
        page: '03 / 06',
        env: '同一办公室',
      })],
      ['04-scene-remote.png', steps({
        kicker: '场景三',
        title: '跨城给家人传，\n他们不会装软件',
        items: [
          { n: '1', t: '你打开 127.0.0.1:8787，把 6 位取件码发过去', d: '微信里发一串数字，比发链接还简单' },
          { n: '2', t: '对方在老家打开网页，输码', d: '不用注册、不用装任何东西' },
          { n: '3', t: '你选文件，对方确认保存位置', d: '传的时候还能切到「消息」说两句' },
        ],
        page: '04 / 06',
        env: '跨网络',
      })],
      ['05-common.png', list({
        kicker: '共同点',
        title: '三个场景，共同的 3 件事',
        items: [
          { k: '·', t: '不压缩', d: '照片、视频原样过去，不用再让对方「点原图」' },
          { k: '·', t: '不留副本', d: '直连时文件不经过服务器；打不通也默认不上传' },
          { k: '·', t: '不用账号', d: '没有注册、没有好友关系；关掉页面就散了' },
        ],
        foot: '临时传一下，传完就结束——这才是「随手」该有的样子。',
        page: '05 / 06',
        env: '3 件事',
      })],
      ['06-end.png', end({
        title: '临时传一下，\n别折腾了',
        lead: '数据线、网盘、聊天软件发原图，<br />都可以省掉。',
        how: '搜 <b>SixDrop</b>，或直接输 <b>127.0.0.1:8787</b><br />同一个网络点设备，跨网络用 6 位码',
        page: '06 / 06',
        env: 'SixDrop',
      })],
    ],
  },
  {
    dir: '03-选题3-速度真相',
    cards: [
      ['01-cover.png', cover({
        badge: '科普 · 说清楚',
        title: '同一个工具，<br />为什么<em>有时快有时慢</em>？',
        sub: '传文件的速度不是玄学——<br />5 个因素，再加一条「打不通怎么办」。',
        page: '01 / 07',
        env: '速度因素',
      })],
      ['02-factor1.png', list({
        kicker: '因素 ①',
        title: '在不在同一个网络',
        items: [
          { k: '·', t: '同一个 Wi-Fi', d: '可能直接走局域网直连——通常是最快的一档' },
          { k: '·', t: '跨网络', d: '要先打洞；能不能打通看两边的 NAT，通了才谈速度' },
        ],
        foot: '所以「同一个 Wi-Fi」和「一个在老家」是两种完全不同的传输。',
        page: '02 / 07',
        env: '① 同一网络？',
      })],
      ['03-factor2.png', list({
        kicker: '因素 ②',
        title: '两边各是什么网络',
        items: [
          { k: '·', t: '有线千兆 > Wi-Fi 6 > Wi-Fi 5 > 4G / 5G', d: '手机往往是瓶颈：无线、发热、省电策略都会拖速度' },
          { k: '·', t: '公司网、校园网、部分移动网络', d: '常是对称 NAT，打洞成功率低' },
        ],
        page: '03 / 07',
        env: '② 什么网络',
      })],
      ['04-factor3.png', list({
        kicker: '因素 ③',
        title: '出口是不是固定的',
        items: [
          { k: '·', t: '双 WAN 分流 / CGNAT / VPN', d: '同一台设备两次连接都可能换一个出口地址' },
          { k: '·', t: '影响的是「自动发现」和链路质量', d: '两条链路质量不一样，走哪条得看这次落到哪个出口' },
        ],
        foot: '大厅里显示「网络组」：两台对不上，就用取件码，别跟 NAT 较劲。',
        page: '04 / 07',
        env: '③ 出口稳不稳',
      })],
      ['05-factor45.png', list({
        kicker: '因素 ④⑤',
        title: '文件本身，和对方的设备',
        items: [
          { k: '·', t: '一个大文件，比几百个小文件更顺', d: '分块 256 KiB 一块；文件太碎，握手和确认的开销就上来了' },
          { k: '·', t: '接收端怎么写盘', d: 'Chrome / Edge 能边收边写；Firefox / Safari 先收进内存，单文件建议 < 1 GB' },
          { k: '·', t: '手机的状态', d: '发热、后台省电、磁盘慢，都会让速度掉下来' },
        ],
        page: '05 / 07',
        env: '④⑤ 文件与设备',
      })],
      ['06-fail.png', list({
        kicker: '打不通的时候',
        title: '打洞失败，\n接下来会发生什么',
        items: [
          { k: '·', t: '不会「偷偷变成上传」', d: '默认不用中转；打不通就停下，文件不会经过服务器' },
          { k: '·', t: '会告诉你卡在哪', d: '失败页给出候选统计（host / srflx / relay，有没有 IPv6）和失败类型' },
          { k: '·', t: '对方不会一直干等', d: '对端同时收到通知，两边都能重试或换路' },
        ],
        foot: '所以「传不过去」是个明确结果，不是一直转圈。',
        page: '06 / 07',
        env: '失败之后',
      })],
      ['07-next.png', list({
        kicker: '后续',
        title: '接下来，三条路',
        items: [
          { k: '①', t: '换个网络再试', d: '手机热点、换一个 Wi-Fi；对称 NAT 下换个出口，成功率明显更高' },
          { k: '②', t: '点「重新尝试」', d: '同一个取件码重连，房间和已选文件都还在，不用重新发码' },
          { k: '③', t: '改用中转（R2）', d: '打不通时的兜底：文件经服务器转一趟，能传但更慢、更费流量，传完可删' },
        ],
        foot: '中转是你主动点的，不是默认；大文件先看看大小再决定。',
        page: '07 / 07',
        env: '三条路',
      })],
    ],
  },
];

/* ---------------- 渲染 ---------------- */

if (!EDGE) console.warn('  ! 没找到 Edge，用内置 Chromium');

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
for (const topic of TOPICS) {
  const dir = join(OUT, topic.dir);
  await mkdir(dir, { recursive: true });
  for (const [file, html] of topic.cards) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 }, deviceScaleFactor: 1 });
    await page.setContent(html);
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(dir, file), clip: { x: 0, y: 0, width: 1200, height: 1600 } });
    console.log(`  ${topic.dir}\\${file}`);
    await page.close();
  }
}
await browser.close();
