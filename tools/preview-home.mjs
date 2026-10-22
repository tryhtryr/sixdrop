/** 截图看看首页（大厅）和标题栏的 logo 效果 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'https://sixdrop.dev';
const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
const page = await browser.newPage({ viewport: { width: 460, height: 760 }, deviceScaleFactor: 2 });
// 大厅每 5 秒轮询一次同网列表，等 networkidle 会永远等不到
await page.goto(BASE, { waitUntil: 'domcontentloaded' });

// 等取件码真的出来，别截到一个 ------ 的空大厅
await page.waitForFunction(
  () => /^[2-9A-HJ-NP-Z]{6}$/.test(document.getElementById('lobby-code').textContent.trim()),
  null,
  { timeout: 20000 },
);

const out = new URL('../public/logo/preview-home.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
await page.screenshot({ path: out });
console.log('  saved preview-home.png');
await browser.close();
