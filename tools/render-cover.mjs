/**
 * 知乎文章封面 1146×717（知乎推荐比例）
 *   node tools/render-cover.mjs
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ICON = `${ROOT}public/icon.svg`;
const OUT = `${ROOT}public/logo/zhihu-cover.png`;

const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const icon = (await readFile(ICON, 'utf8')).replace(/^\uFEFF/, '').trimStart();

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1146px;height:717px;overflow:hidden}
  body{position:relative;background:#0a0e15;color:#eef2f8;
       font-family:"Segoe UI","Microsoft YaHei",sans-serif;
       display:flex;flex-direction:column;justify-content:center;padding:0 84px}
  .glow{position:absolute;inset:0;
        background:radial-gradient(760px 620px at 24% 30%, #1b2b45 0%, #0d1420 58%, #080b11 100%)}
  .dots{position:absolute;inset:0;opacity:.3;
        background-image:radial-gradient(rgba(120,160,220,.16) 1px, transparent 1px);
        background-size:32px 32px}
  .top{position:relative;display:flex;align-items:center;gap:16px;margin-bottom:44px}
  .top svg{width:58px;height:58px;display:block}
  .brand{font-size:26px;font-weight:700;letter-spacing:-.01em}
  .brand span{color:#6f86a6;font-weight:500;font-size:19px;margin-left:14px;letter-spacing:.02em}
  h1{position:relative;font-size:82px;line-height:1.14;font-weight:800;letter-spacing:-.02em}
  h1 em{font-style:normal;color:#5b95ff}
  p.sub{position:relative;margin-top:26px;font-size:31px;line-height:1.55;color:#a9bbd3;font-weight:400}
  .bar{position:relative;margin-top:40px;width:96px;height:5px;border-radius:3px;
       background:linear-gradient(90deg,#4f8cff,#6fe0c8)}
</style></head><body>
  <div class="glow"></div><div class="dots"></div>
  <div class="top">${icon}<div class="brand">SixDrop<span>sixdrop.dev</span></div></div>
  <h1>传个文件而已<br />为什么要<em>上传一遍</em>？</h1>
  <p class="sub">报 6 位取件码，两个浏览器直接对传</p>
  <div class="bar"></div>
</body></html>`;

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
const page = await browser.newPage({ viewport: { width: 1146, height: 717 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.waitForTimeout(350);
await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1146, height: 717 } });
await browser.close();
console.log(`  ${OUT}`);
