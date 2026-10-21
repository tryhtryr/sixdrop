/**
 * 抖音图文模板 1200×1600（深色 + 蓝绿渐变）
 *   node tools/render-douyin.mjs
 *
 * ⚠️ 改数字只改下面的 DATA，然后重跑一次即可。
 *    等真实测完，把 PLACEHOLDER 改成 false，图上的「示例数据」提示就会消失。
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

/* ================= 只有这一段需要你改 ================= */

const PLACEHOLDER = true; // 实测填完改成 false

const DATA = {
  one: { label: '场景一', title: '手机 → 电脑', env: '同一 WiFi', size: '2.31 GB', time: '48', unit: '秒', speed: '49 MB/s', compare: '网盘要先上传 40 分钟', compareNote: '对方才能开始下', saved: '少等 39 分钟' },
  two: { label: '场景二', title: '电脑 → 电脑', env: '同一路由器', size: '10.2 GB', time: '2:40', unit: '', speed: '65 MB/s', compare: '网盘限速下要 2 小时以上', compareNote: '', saved: '少等 1 小时 57 分' },
  three: { label: '场景三', title: '异地跨网络', env: '不同城市', size: '500 MB', time: '1:12', unit: '', speed: '7 MB/s', compare: '微信 / QQ 直接拒绝大文件', compareNote: '取决于双方上传带宽', saved: '直接发，不用先传一遍' },
};

/* ====================================================== */

const icon = (await readFile(`${ROOT}public/icon.svg`, 'utf8')).replace(/^\uFEFF/, '').trimStart();

const shell = (inner, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:1600px;overflow:hidden}
  body{position:relative;background:#0a0e15;color:#eef2f8;
       font-family:"Segoe UI","Microsoft YaHei",sans-serif;padding:96px 88px;
       display:flex;flex-direction:column}
  .glow{position:absolute;inset:0;
        background:radial-gradient(900px 780px at 30% 12%, #16253c 0%, #0c1220 52%, #080b11 100%)}
  .dots{position:absolute;inset:0;opacity:.26;
        background-image:radial-gradient(rgba(120,160,220,.15) 1px, transparent 1px);
        background-size:36px 36px}
  .top{position:relative;display:flex;align-items:center;gap:14px}
  .top svg{width:52px;height:52px;display:block}
  .top .nm{font-size:25px;font-weight:700}
  .top .env{margin-left:auto;font-size:20px;color:#7e91ab;letter-spacing:.04em}
  .body{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center}
  .kicker{font-size:26px;letter-spacing:.3em;color:#5f708a}
  ${extra}
</style></head><body>
  <div class="glow"></div><div class="dots"></div>
  <div class="top">${icon}<div class="nm">SixDrop</div><div class="env">${inner.env || ''}</div></div>
  ${inner.html}
</body></html>`;

const warn = PLACEHOLDER
  ? `<div style="position:absolute;right:88px;bottom:150px;padding:11px 20px;border-radius:10px;
       background:#3a1f1f;border:1px solid #7a3b3b;color:#f0a3a3;font-size:20px">
       示例数据 · 发布前替换为实测值</div>`
  : '';

/* ---------- 1. 封面 ---------- */
const cover = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:1600px;overflow:hidden}
  body{position:relative;background:#0a0e15;color:#eef2f8;
       font-family:"Segoe UI","Microsoft YaHei",sans-serif;padding:96px 88px;
       display:flex;flex-direction:column;justify-content:center}
  .glow{position:absolute;inset:0;
        background:radial-gradient(980px 860px at 34% 20%, #1b2b45 0%, #0d1420 54%, #080b11 100%)}
  .dots{position:absolute;inset:0;opacity:.3;
        background-image:radial-gradient(rgba(120,160,220,.17) 1px, transparent 1px);
        background-size:34px 34px}
  .brand{position:relative;display:flex;align-items:center;gap:16px;margin-bottom:64px}
  .brand svg{width:64px;height:64px;display:block}
  .brand .n{font-size:30px;font-weight:700}
  .brand .d{font-size:21px;color:#71859f;margin-left:10px}
  h1{position:relative;font-size:124px;line-height:1.14;font-weight:800;letter-spacing:-.02em}
  h1 em{font-style:normal;color:#5b95ff}
  .sub{position:relative;margin-top:44px;font-size:40px;line-height:1.5;color:#a9bbd3}
  .bar{position:relative;margin-top:56px;width:150px;height:7px;border-radius:4px;
       background:linear-gradient(90deg,#4f8cff,#6fe0c8)}
  .tag{position:absolute;right:88px;bottom:96px;font-size:22px;color:#5d708a;letter-spacing:.2em}
</style></head><body>
  <div class="glow"></div><div class="dots"></div>
  <div class="brand">${icon}<div class="n">SixDrop</div><div class="d">传文件 · 不用等</div></div>
  <h1>传文件<br />为什么<em>要先上传</em>？</h1>
  <div class="sub">3 个场景实测，省掉的是 40 分钟</div>
  <div class="bar"></div>
  <div class="tag">01 / 06</div>
</body></html>`;

/* ---------- 2~4. 三个场景 ---------- */
const scene = (d, page, big) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:1600px;overflow:hidden}
  body{position:relative;background:#0a0e15;color:#eef2f8;
       font-family:"Segoe UI","Microsoft YaHei",sans-serif;padding:96px 88px 132px;
       display:flex;flex-direction:column}
  .glow{position:absolute;inset:0;
        background:radial-gradient(900px 760px at 26% 10%, #16253c 0%, #0c1220 54%, #080b11 100%)}
  .dots{position:absolute;inset:0;opacity:.24;
        background-image:radial-gradient(rgba(120,160,220,.14) 1px, transparent 1px);
        background-size:36px 36px}
  .top{position:relative;display:flex;align-items:center;gap:14px}
  .top svg{width:50px;height:50px;display:block}
  .top .nm{font-size:24px;font-weight:700;color:#b9c7db}
  .top .env{margin-left:auto;font-size:21px;color:#71859f}
  .kicker{position:relative;margin-top:110px;font-size:30px;letter-spacing:.28em;color:#5f708a}
  h2{position:relative;margin-top:22px;font-size:84px;font-weight:800;letter-spacing:-.02em}
  .stack{position:relative;margin-top:78px;display:flex;flex-direction:column;gap:26px}
  .row{display:flex;align-items:baseline;gap:20px}
  .k{width:200px;font-size:30px;color:#7e91ab}
  .v{font-size:44px;font-weight:600}
  .hero{position:relative;margin-top:56px;padding:56px 52px;border-radius:26px;
        background:linear-gradient(135deg,rgba(79,140,255,.16),rgba(111,224,200,.10));
        border:1px solid #24426b;display:flex;align-items:flex-end;gap:20px}
  .hero .num{font-size:210px;line-height:.86;font-weight:800;
             background:linear-gradient(120deg,#7fb4ff,#6fe0c8);-webkit-background-clip:text;
             -webkit-text-fill-color:transparent}
  .hero .u{font-size:56px;color:#9fb6d6;padding-bottom:22px}
  .hero .sp{margin-left:auto;text-align:right;padding-bottom:26px}
  .hero .sp .s{font-size:40px;font-weight:600;color:#cfe0f5}
  .hero .sp .l{font-size:22px;color:#7e91ab;margin-top:8px}
  .cmp{position:relative;margin-top:64px;padding-left:24px;border-left:5px solid #33507a}
  .cmp .a{font-size:36px;color:#c9d6e8}
  .cmp .b{font-size:26px;color:#7e91ab;margin-top:12px}
  .tag{position:absolute;right:88px;bottom:96px;font-size:22px;color:#5d708a;letter-spacing:.2em}
  .saved{position:relative;margin-top:auto;padding-top:42px;border-top:1px solid #1b2536}
  .saved .sl{font-size:24px;color:#6f86a6;letter-spacing:.16em}
  .saved .sv{margin-top:14px;font-size:66px;font-weight:800;letter-spacing:-.01em;
             background:linear-gradient(100deg,#8fc0ff,#6fe0c8);-webkit-background-clip:text;
             -webkit-text-fill-color:transparent}
  .swipe{position:relative;margin-top:34px;font-size:24px;color:#5d708a}
</style></head><body>
  <div class="glow"></div><div class="dots"></div>
  <div class="top">${icon}<div class="nm">SixDrop</div><div class="env">${d.env}</div></div>
  <div class="kicker">${d.label}</div>
  <h2>${d.title}</h2>
  <div class="stack">
    <div class="row"><div class="k">文件大小</div><div class="v">${d.size}</div></div>
  </div>
  <div class="hero">
    <div class="num">${d.time}</div><div class="u">${d.unit}</div>
    <div class="sp"><div class="s">${d.speed}</div><div class="l">平均速度</div></div>
  </div>
  <div class="cmp">
    <div class="a">${d.compare}</div>
    ${d.compareNote ? `<div class="b">${d.compareNote}</div>` : ''}
  </div>
  <div class="saved">
    <div class="sl">这一次</div>
    <div class="sv">${d.saved}</div>
  </div>
    <div class="swipe">左滑看下一个场景 →</div>
  </div>
  ${warn}
  <div class="tag">${page} / 06</div>
</body></html>`;

/* ---------- 5. 原理 ---------- */
const why = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:1600px;overflow:hidden}
  body{position:relative;background:#0a0e15;color:#eef2f8;
       font-family:"Segoe UI","Microsoft YaHei",sans-serif;padding:96px 88px;
       display:flex;flex-direction:column}
  .glow{position:absolute;inset:0;
        background:radial-gradient(900px 760px at 26% 10%, #16253c 0%, #0c1220 54%, #080b11 100%)}
  .dots{position:absolute;inset:0;opacity:.24;
        background-image:radial-gradient(rgba(120,160,220,.14) 1px, transparent 1px);
        background-size:36px 36px}
  .top{position:relative;display:flex;align-items:center;gap:14px}
  .top svg{width:50px;height:50px;display:block}
  .top .nm{font-size:24px;font-weight:700;color:#b9c7db}
  .kicker{position:relative;margin-top:86px;font-size:30px;letter-spacing:.28em;color:#5f708a}
  h2{position:relative;margin-top:22px;font-size:80px;font-weight:800;letter-spacing:-.02em}
  .diagram{position:relative;margin-top:54px}
  .note{position:relative;margin-top:auto;margin-bottom:80px;font-size:38px;line-height:1.72;color:#b9c8dc}
  .note b{color:#7fb4ff}
  .tag{position:absolute;right:88px;bottom:96px;font-size:22px;color:#5d708a;letter-spacing:.2em}
</style></head><body>
  <div class="glow"></div><div class="dots"></div>
  <div class="top">${icon}<div class="nm">SixDrop</div></div>
  <div class="kicker">原理</div>
  <h2>文件不经过服务器</h2>
  <div class="diagram">
    <svg width="1024" height="600" viewBox="0 0 1024 600" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g1" gradientUnits="userSpaceOnUse" x1="60" y1="0" x2="860" y2="0">
          <stop offset="0" stop-color="#7fb4ff"/><stop offset="1" stop-color="#6fe0c8"/>
        </linearGradient>
        <marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="#6fe0c8"/>
        </marker>
      </defs>

      <rect x="40" y="120" width="290" height="190" rx="26" fill="#111a28" stroke="#2a3f5c" stroke-width="2.5"/>
      <text x="185" y="205" text-anchor="middle" font-size="38" font-weight="700" fill="#dbe6f5">你的设备</text>
      <text x="185" y="255" text-anchor="middle" font-size="25" fill="#7e91ab">浏览器</text>

      <rect x="694" y="120" width="290" height="190" rx="26" fill="#111a28" stroke="#2a3f5c" stroke-width="2.5"/>
      <text x="839" y="205" text-anchor="middle" font-size="38" font-weight="700" fill="#dbe6f5">对方设备</text>
      <text x="839" y="255" text-anchor="middle" font-size="25" fill="#7e91ab">浏览器</text>

      <line x1="336" y1="215" x2="682" y2="215" stroke="url(#g1)" stroke-width="9"
            stroke-linecap="round" marker-end="url(#ar)"/>
      <text x="512" y="176" text-anchor="middle" font-size="30" font-weight="700" fill="#8fc0ff">点对点直连</text>
      <text x="512" y="272" text-anchor="middle" font-size="24" fill="#6f86a6">加密 · 不落盘</text>

      <rect x="356" y="424" width="312" height="140" rx="20" fill="#1a1414" stroke="#4a2b2b" stroke-width="2"/>
      <text x="512" y="478" text-anchor="middle" font-size="30" font-weight="700" fill="#a87a7a">服务器</text>
      <text x="512" y="520" text-anchor="middle" font-size="22" fill="#7a5252">只转发信令，不碰文件</text>
      <circle cx="646" cy="452" r="25" fill="#b4463f"/>
      <path d="M636 442 L656 462 M656 442 L636 462" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
    </svg>
  </div>
  <div class="note">
    文件从你的设备直接流到对方设备，<br />
    中间<b>没有一台机器在转发</b>，自然也就没有「服务器限速」。
  </div>
  <div class="tag">05 / 06</div>
</body></html>`;

/* ---------- 6. 结尾 ---------- */
const end = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:1600px;overflow:hidden}
  body{position:relative;background:#0a0e15;color:#eef2f8;
       font-family:"Segoe UI","Microsoft YaHei",sans-serif;padding:96px 88px;
       display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
  .glow{position:absolute;inset:0;
        background:radial-gradient(820px 900px at 50% 42%, #1b2b45 0%, #0d1420 56%, #080b11 100%)}
  .dots{position:absolute;inset:0;opacity:.3;
        background-image:radial-gradient(rgba(120,160,220,.17) 1px, transparent 1px);
        background-size:34px 34px}
  .mark{position:relative;margin-bottom:56px}
  .mark svg{width:220px;height:220px;display:block;filter:drop-shadow(0 26px 60px rgba(79,140,255,.35))}
  h2{position:relative;font-size:96px;font-weight:800;letter-spacing:-.02em}
  .lead{position:relative;margin-top:34px;font-size:40px;line-height:1.6;color:#a9bbd3}
  .how{position:relative;margin-top:80px;padding:48px 56px;border-radius:24px;
       background:rgba(255,255,255,.03);border:1px solid #223148}
  .how .s{font-size:34px;color:#c9d7ea;line-height:1.8}
  .how .s b{color:#7fb4ff}
  .tag{position:absolute;right:88px;bottom:96px;font-size:22px;color:#5d708a;letter-spacing:.2em}
</style></head><body>
  <div class="glow"></div><div class="dots"></div>
  <div class="mark">${icon}</div>
  <h2>SixDrop</h2>
  <div class="lead">不用注册，不用装 App<br />打开网页就能传</div>
  <div class="how">
    <div class="s">搜 <b>SixDrop</b>，或者输 <b>sixdrop.dev</b></div>
    <div class="s" style="margin-top:14px;font-size:28px;color:#7e91ab">6 位取件码 · 点对点直传</div>
  </div>
  <div class="tag">06 / 06</div>
</body></html>`;

const cards = [
  ['01-cover.png', cover],
  ['02-scene-phone.png', scene(DATA.one, '02')],
  ['03-scene-lan.png', scene(DATA.two, '03')],
  ['04-scene-wan.png', scene(DATA.three, '04')],
  ['05-why.png', why],
  ['06-end.png', end],
];

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
for (const [file, html] of cards) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.waitForTimeout(260);
  await page.screenshot({ path: `${ROOT}public/douyin/${file}`, clip: { x: 0, y: 0, width: 1200, height: 1600 } });
  console.log(`  public/douyin/${file}`);
  await page.close();
}
await browser.close();
