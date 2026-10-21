import { chromium } from 'playwright-core';
const BASE = 'http://127.0.0.1:8787';
const b = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
const s = await b.newPage();
const r = await b.newPage();
for (const [n, p] of [['S', s], ['R', r]]) {
  p.on('pageerror', (e) => console.log(`  [${n}] pageerror:`, e.message));
  p.on('console', (m) => console.log(`  [${n}] ${m.type()}: ${m.text()}`));
}
await r.addInitScript(() => { window.showSaveFilePicker = undefined; window.showDirectoryPicker = undefined; window.__blobs = []; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (x) => { window.__blobs.push(x.size); return o(x); }; });
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
for (let i = 0; i < 15; i++) {
  await new Promise((x) => setTimeout(x, 1000));
  const st = await r.evaluate(() => ({
    stats: document.getElementById('xfer-stats')?.textContent,
    back: !document.getElementById('back')?.hidden,
    done: window.__doneFlag,
  }));
  const sd = await s.evaluate(() => ({
    stats: document.getElementById('xfer-stats')?.textContent,
    sub: document.getElementById('xfer-sub')?.textContent,
    buffered: window.__buf,
  }));
  console.log(`  t=${i + 1}s R[${st.stats}] back=${st.back} | S[${sd.sub}]`);
  if (st.back) break;
}
await b.close();
