/**
 * 生成抖音主页用的背景图：
 *   public/logo/douyin-vertical.png  1080×1920（竖版）
 *   public/logo/douyin-banner.png    1125×633 （抖音主页实际使用的横版）
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

const icon = await readFile(`${ROOT}public/icon.svg`, 'utf8');

const page_ = (body, css) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%}
  body{overflow:hidden;font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#eef2f8;
       background:#0a0e15;display:flex;align-items:center;justify-content:center;position:relative}
  .glow{position:absolute;inset:0;
        background:radial-gradient(900px 700px at 50% 28%, #1b2b45 0%, #0d1420 55%, #080b11 100%)}
  .dots{position:absolute;inset:0;opacity:.35;
        background-image:radial-gradient(rgba(120,160,220,.18) 1px, transparent 1px);
        background-size:34px 34px}
  .content{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center}
  .mark svg{display:block}
  h1{font-weight:800;letter-spacing:-1px}
  .tag{color:#c3d2e6;font-weight:500}
  .sub{color:#7d8ea6}
  .url{font-family:ui-monospace,Consolas,monospace;color:#5b95ff;letter-spacing:.02em}
  ${css}
</style></head><body><div class="glow"></div><div class="dots"></div>${body}</body></html>`;

// 竖版：内容压在中间，上下留出抖音裁剪的安全区
const vertical = page_(
  `<div class="content">
     <div class="mark">${icon}</div>
     <h1>SixDrop</h1>
     <p class="tag">六位取件码 · 点对点直传</p>
     <p class="sub">文件不经过服务器</p>
     <p class="url">免注册 · 免安装 · 手机电脑互传</p>
   </div>`,
  `.mark svg{width:300px;height:300px}
   .mark{margin-bottom:46px;filter:drop-shadow(0 24px 60px rgba(79,140,255,.32))}
   h1{font-size:132px;line-height:1;margin-bottom:34px}
   .tag{font-size:44px;line-height:1.5;margin-bottom:14px}
   .sub{font-size:36px;margin-bottom:64px}
   .url{font-size:34px;color:#8fb4e8}`,
);

// 横版：抖音主页实际显示的区域，左边留白避免头像遮挡
const banner = page_(
  `<div class="content">
     <div class="row">
       <div class="mark">${icon}</div>
       <div class="words">
         <h1>SixDrop</h1>
         <p class="tag">六位取件码 · 点对点直传</p>
         <p class="url">免注册 · 免安装</p>
       </div>
     </div>
   </div>`,
  `.content{padding-left:60px;padding-bottom:40px}
   .row{display:flex;align-items:center;gap:46px}
   .mark svg{width:190px;height:190px}
   .words{text-align:left}
   h1{font-size:86px;line-height:1;margin-bottom:22px}
   .tag{font-size:30px;line-height:1.4;margin-bottom:26px}
   .url{font-size:26px;color:#8fb4e8}`,
);

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });

for (const [html, w, h, file] of [
  [vertical, 1080, 1920, 'douyin-vertical.png'],
  [banner, 1125, 633, 'douyin-banner.png'],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${ROOT}public/logo/${file}` });
  console.log(`  ${file}  ${w}×${h}`);
  await page.close();
}

await browser.close();
