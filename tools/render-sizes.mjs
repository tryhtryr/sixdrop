/**
 * 把一个 SVG 渲染成多尺寸对比图。
 *   node tools/render-sizes.mjs tools/logo-a2.svg public/logo/sizes-a2.png
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const svgPath = process.argv[2];
const out = process.argv[3] || 'public/logo/sizes.png';
const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const svg = await readFile(`${ROOT}${svgPath}`, 'utf8');
const sizes = [160, 96, 64, 44, 32, 20];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0e15;display:flex;align-items:flex-end;gap:26px;padding:36px}
  .item{display:flex;flex-direction:column;align-items:center;gap:10px}
  .item svg{display:block}
  .cap{color:#7d8ea6;font:12px/1 "Segoe UI",sans-serif}
</style></head><body>
${sizes.map((s) => `<div class="item"><div style="width:${s}px;height:${s}px">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</div><div class="cap">${s}px</div></div>`).join('')}
</body></html>`;

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 260 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.waitForTimeout(250);
await page.screenshot({ path: `${ROOT}${out}` });
await browser.close();
console.log(`  ${out}`);
