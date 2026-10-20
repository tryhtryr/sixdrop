/**
 * 打开一个分享页，看看它到底渲染成什么。
 *   node tools/share-check.mjs <token>
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'https://sixdrop.dev';
const token = process.argv[2];
if (!token) {
  console.error('用法: node tools/share-check.mjs <token>');
  process.exit(1);
}

const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
const page = await browser.newPage();

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`${BASE}/d/${token}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const state = await page.evaluate(() => ({
  visibleView: [...document.querySelectorAll('.view')].filter((v) => !v.hidden).map((v) => v.id),
  relayTitle: document.getElementById('relay-title')?.textContent,
  errorTitle: document.getElementById('error-title')?.textContent,
  stats: document.getElementById('relay-stats')?.textContent,
  links: [...document.querySelectorAll('#relay-list a')].map((a) => a.textContent),
}));

console.log(' 可见视图:', state.visibleView.join(', ') || '(无)');
if (state.relayTitle) console.log(' 中转标题:', state.relayTitle);
if (state.errorTitle) console.log(' 错误标题:', state.errorTitle);
if (state.stats) console.log(' 状态文案:', state.stats);
console.log(' 文件链接:', state.links.join(', ') || '(无)');
if (errors.length) console.log(' 页面报错:', errors.slice(0, 5).join(' | '));

await browser.close();
