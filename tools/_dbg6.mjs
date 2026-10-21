import { chromium } from 'playwright-core';
const BASE = 'http://127.0.0.1:8787';
const b = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
const s = await b.newPage();
const r = await b.newPage();
const dump = async (p) => p.evaluate(() => ({
  view: [...document.querySelectorAll('.view')].filter((v) => !v.hidden).map((v) => v.id).join(','),
  err: document.getElementById('error-title')?.textContent + ' | ' + document.getElementById('error-text')?.textContent,
  stats: document.getElementById('xfer-stats')?.textContent,
}));
for (const [n, p] of [['S', s], ['R', r]]) p.on('pageerror', (e) => console.log(`  [${n}] pageerror:`, e.message));
await r.addInitScript(() => { window.showSaveFilePicker = undefined; window.showDirectoryPicker = undefined; });
await s.goto(BASE); await r.goto(BASE);
await s.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(64 * 1024 * 1024)], 'big.bin'));
  const i = document.getElementById('file'); i.files = dt.files;
  i.dispatchEvent(new Event('change', { bubbles: true }));
});
await s.waitForFunction(() => /^[2-9A-HJ-NP-Z]{6}$/.test(document.getElementById('room-code').textContent.trim()), null, { timeout: 15000 });
const code = (await s.locator('#room-code').textContent()).trim();
await r.fill('#code', code); await r.press('#code', 'Enter');
await r.waitForSelector('#view-ask:not([hidden])', { timeout: 20000 });
await r.click('#accept');
await new Promise((x) => setTimeout(x, 3000));
console.log('  S:', JSON.stringify(await dump(s)));
console.log('  R:', JSON.stringify(await dump(r)));
await b.close();
