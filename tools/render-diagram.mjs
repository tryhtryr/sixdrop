/**
 * 给文章用的链路示意图（知乎不能贴 ASCII 对齐图）
 *   node tools/render-diagram.mjs → public/logo/diagram-flow.png
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const W = 1180;
const H = 720;
const L = 150; // 发送方
const M = 590; // 信令服务器
const R = 1030; // 接收方

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:#fff}
  body{font-family:"Segoe UI","Microsoft YaHei",sans-serif}
  text{font-family:"Segoe UI","Microsoft YaHei",sans-serif}
</style></head><body>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#4f8cff"/>
    </marker>
    <marker id="ag" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#2fb98a"/>
    </marker>
    <linearGradient id="chan" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4f8cff" stop-opacity=".18"/>
      <stop offset="0.5" stop-color="#4f8cff" stop-opacity=".10"/>
      <stop offset="1" stop-color="#4f8cff" stop-opacity=".18"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#ffffff"/>

  <!-- 列标题 -->
  ${[
    [L, '发送方', '你的浏览器'],
    [M, '信令服务器', 'Cloudflare Worker + DO'],
    [R, '接收方', '对方的浏览器'],
  ]
    .map(
      ([x, t, s]) => `
    <rect x="${x - 118}" y="42" width="236" height="66" rx="14" fill="#f2f6fc" stroke="#dbe5f3"/>
    <text x="${x}" y="70" text-anchor="middle" font-size="22" font-weight="700" fill="#16233a">${t}</text>
    <text x="${x}" y="92" text-anchor="middle" font-size="14" fill="#6b7d96">${s}</text>`,
    )
    .join('')}

  <!-- 竖向虚线 -->
  ${[L, M, R]
    .map((x) => `<line x1="${x}" y1="118" x2="${x}" y2="600" stroke="#d8e1ee" stroke-width="1.5" stroke-dasharray="5 7"/>`)
    .join('')}

  <!-- ① 建房 -->
  <line x1="${L + 24}" y1="176" x2="${M - 26}" y2="176" stroke="#4f8cff" stroke-width="2.2" marker-end="url(#a)"/>
  <text x="${(L + M) / 2}" y="162" text-anchor="middle" font-size="16" font-weight="600" fill="#2b4266">① 建房 → 得到 6 位取件码</text>

  <!-- ② 输入取件码 -->
  <line x1="${R - 24}" y1="232" x2="${M + 26}" y2="232" stroke="#4f8cff" stroke-width="2.2" marker-end="url(#a)"/>
  <text x="${(M + R) / 2}" y="218" text-anchor="middle" font-size="16" font-weight="600" fill="#2b4266">② 输入取件码</text>

  <!-- ③ offer -->
  <polyline points="${L + 24},300 ${M},300" fill="none" stroke="#4f8cff" stroke-width="2.2" marker-end="url(#a)"/>
  <line x1="${M}" y1="300" x2="${R - 26}" y2="300" stroke="#4f8cff" stroke-width="2.2" marker-end="url(#a)"/>
  <circle cx="${M}" cy="300" r="5" fill="#4f8cff"/>
  <text x="${(L + M) / 2}" y="286" text-anchor="middle" font-size="16" font-weight="600" fill="#2b4266">③ SDP offer</text>

  <!-- ④ answer -->
  <polyline points="${R - 24},360 ${M},360" fill="none" stroke="#8a9bb5" stroke-width="2.2" marker-end="url(#a)"/>
  <line x1="${M}" y1="360" x2="${L + 26}" y2="360" stroke="#8a9bb5" stroke-width="2.2" marker-end="url(#a)"/>
  <circle cx="${M}" cy="360" r="5" fill="#8a9bb5"/>
  <text x="${(L + M) / 2}" y="346" text-anchor="middle" font-size="16" font-weight="600" fill="#5a6c85">④ SDP answer</text>

  <!-- 直连通道 -->
  <rect x="${L + 12}" y="452" width="${R - L - 24}" height="76" rx="16" fill="url(#chan)" stroke="#9dc0f5" stroke-width="1.6"/>
  <text x="${(L + R) / 2}" y="484" text-anchor="middle" font-size="21" font-weight="700" fill="#1d4ed8">
    WebRTC DataChannel（DTLS 加密）
  </text>
  <text x="${(L + R) / 2}" y="512" text-anchor="middle" font-size="16" fill="#41597c">
    文件字节在这里直接对传，服务器完全不参与
  </text>
  <line x1="${L + 22}" y1="566" x2="${R - 22}" y2="566" stroke="#2fb98a" stroke-width="2.6"
        marker-start="url(#ag)" marker-end="url(#ag)"/>

  <!-- 服务器不碰数据 -->
  <line x1="${M}" y1="118" x2="${M}" y2="566" stroke="#d8e1ee" stroke-width="1.5" stroke-dasharray="5 7"/>
  <rect x="${M - 96}" y="600" width="192" height="40" rx="10" fill="#fff5f5" stroke="#f3c9c9"/>
  <text x="${M}" y="626" text-anchor="middle" font-size="15" fill="#b4463f">只转发信令，不碰文件</text>

  <text x="${W / 2}" y="690" text-anchor="middle" font-size="15" fill="#8a97a8">
    连接建立后，即使信令服务器掉线，传输也会继续
  </text>
</svg>
</body></html>`;

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.waitForTimeout(300);
await page.screenshot({ path: `${ROOT}public/logo/diagram-flow.png`, clip: { x: 0, y: 0, width: W, height: H } });
await browser.close();
console.log('  public/logo/diagram-flow.png');
