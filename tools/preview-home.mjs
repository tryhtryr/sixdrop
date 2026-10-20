/** 截图看看首页和标题栏的 logo 效果 */
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
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const out = new URL('../public/logo/preview-home.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
await page.screenshot({ path: out });
console.log('  saved preview-home.png');
await browser.close();
