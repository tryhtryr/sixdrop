/**
 * 深挖分享页为什么没渲染：记录所有请求/响应和最终 DOM。
 *   node tools/share-debug.mjs <token>
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const token = process.argv[2] || '';
const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
const page = await browser.newPage();

page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/') || u.endsWith('app.js')) console.log(`   ← ${r.status()} ${u.replace(BASE, '')}`);
});
page.on('requestfailed', (r) => console.log(`   ✗ ${r.url().replace(BASE, '')} ${r.failure()?.errorText}`));
page.on('pageerror', (e) => console.log('   pageerror:', e.message));

await page.goto(`${BASE}/d/${token}`, { waitUntil: 'domcontentloaded' });
console.log('   实际 URL:', page.url());
await page.waitForTimeout(6000);

const state = await page.evaluate(() => ({
  path: location.pathname,
  views: [...document.querySelectorAll('.view')].filter((v) => !v.hidden).map((v) => v.id),
  relayStats: document.getElementById('relay-stats')?.textContent,
  errorTitle: document.getElementById('error-title')?.textContent,
  links: [...document.querySelectorAll('#relay-list a')].length,
}));
console.log('   状态:', JSON.stringify(state));

await browser.close();
