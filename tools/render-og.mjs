/**
 * 生成社交分享卡片 public/logo/og.png (1200×630)。
 *   node tools/render-og.mjs
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
const tpl = await readFile(`${ROOT}tools/og-template.html`, 'utf8');
const html = tpl.replace('__ICON_SVG__', icon);

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.waitForTimeout(300);
await page.screenshot({ path: `${ROOT}public/logo/og.png` });
await browser.close();
console.log('  public/logo/og.png  1200×630');
