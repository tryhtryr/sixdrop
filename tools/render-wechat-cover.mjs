/**
 * 公众号首图封面 900×383（2.35:1）与正方形 200×200
 *   node tools/render-wechat-cover.mjs
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

const icon = (await readFile(`${ROOT}public/icon.svg`, 'utf8')).replace(/^\uFEFF/, '').trimStart();
const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });

/* ---------- 首图 900×383 ---------- */
const wide = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:900px;height:383px;overflow:hidden}
  body{position:relative;background:#0a0e15;color:#eef2f8;
       font-family:"Segoe UI","Microsoft YaHei",sans-serif;
       display:flex;align-items:center;justify-content:space-between;padding:0 62px}
  .glow{position:absolute;inset:0;
        background:radial-gradient(620px 460px at 22% 40%, #1b2b45 0%, #0d1420 60%, #080b11 100%)}
  .dots{position:absolute;inset:0;opacity:.28;
        background-image:radial-gradient(rgba(120,160,220,.16) 1px, transparent 1px);
        background-size:30px 30px}
  .left{position:relative}
  .kicker{font-size:15px;letter-spacing:.24em;color:#6f86a6;margin-bottom:20px}
  h1{font-size:52px;line-height:1.24;font-weight:800;letter-spacing:-.01em}
  h1 em{font-style:normal;color:#5b95ff}
  .sub{margin-top:18px;font-size:19px;color:#9fb2ca}
  .right{position:relative;display:flex;flex-direction:column;align-items:center;gap:14px}
  .right svg{width:118px;height:118px;display:block;filter:drop-shadow(0 16px 40px rgba(79,140,255,.35))}
  .right .d{font-size:14px;letter-spacing:.12em;color:#6f86a6}
</style></head><body>
  <div class="glow"></div><div class="dots"></div>
  <div class="left">
    <div class="kicker">SIXDROP</div>
    <h1>传个文件而已<br />为什么要<em>上传一遍</em>？</h1>
    <div class="sub">报 6 位取件码，两个浏览器直接对传</div>
  </div>
  <div class="right">${icon}<div class="d">127.0.0.1:8787</div></div>
</body></html>`;

/* ---------- 正方形 200×200（用于分享缩略图） ---------- */
const square = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:200px;height:200px;overflow:hidden;background:#0a0e15;
       display:flex;align-items:center;justify-content:center}
  body{font-family:"Segoe UI","Microsoft YaHei",sans-serif}
  svg{width:150px;height:150px;display:block}
</style></head><body>${icon}</body></html>`;

for (const [html, w, h, file] of [
  [wide, 900, 383, 'wechat-cover.png'],
  [square, 200, 200, 'wechat-square.png'],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.setContent(html);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${ROOT}public/logo/${file}`, clip: { x: 0, y: 0, width: w, height: h } });
  console.log(`  ${file}  ${w}×${h}`);
  await page.close();
}

await browser.close();
