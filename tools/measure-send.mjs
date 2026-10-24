/**
 * 反向测速：本机作为发送方，手机作为接收方。
 *   node tools/measure-send.mjs [MB]
 * 会打印一个取件码，在手机上输进去即可。
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const MB = Number(process.argv[2] || 300);
const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const log = (m) => console.log(`  ${new Date().toLocaleTimeString('zh-CN')}  ${m}`);

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on('pageerror', (e) => console.log('  页面错误:', e.message));

await page.goto(process.env.SEND_URL || 'http://127.0.0.1:8787', { waitUntil: 'domcontentloaded' });

// 造一个 MB 大小的文件塞进文件选择框
await page.evaluate((mb) => {
  const size = mb * 1024 * 1024;
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 4096) bytes[i] = (i / 4096) & 255; // 略微非零，避免被优化
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], `speedtest-${mb}mb.bin`, { type: 'application/octet-stream' }));
  const input = document.getElementById('file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, MB);

await page.waitForFunction(
  () => /^[2-9A-HJ-NP-Z]{6}$/.test(document.getElementById('room-code').textContent.trim()),
  null,
  { timeout: 20000 },
);
const code = (await page.locator('#room-code').textContent()).trim();

console.log('');
console.log('  ╔════════════════════════════════╗');
console.log(`  ║   取件码   ${code}            ║`);
console.log('  ╚════════════════════════════════╝');
console.log(`  文件：${MB} MB · 在手机 127.0.0.1:8787 输入上面的码并点接收`);
console.log('');

log('等待手机接入…');
await page.waitForFunction(() => !document.getElementById('view-xfer').hidden, null, { timeout: 300000 });

const started = Date.now();
log('对方已接入，开始计时');

let last = '';
while (Date.now() - started < 900000) {
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => ({
    stats: document.getElementById('xfer-stats')?.textContent || '',
    sub: document.getElementById('xfer-sub')?.textContent || '',
    path: document.getElementById('path')?.textContent || '',
    verify: document.getElementById('verify-code')?.textContent || '',
  }));

  if (info.stats !== last) {
    last = info.stats;
    process.stdout.write(`\r  ${info.stats}`.padEnd(62));
  }

  if (/发送完成/.test(info.sub)) {
    const seconds = (Date.now() - started) / 1000;
    console.log('');
    log(`发送完成 · ${seconds.toFixed(2)} 秒`);
    log(`平均速度 · ${(MB / seconds).toFixed(1)} MB/s`);
    log(`链路 · ${info.path || '(未知)'}`);
    log(`校验码 · ${info.verify || '(无)'}`);
    console.log(`\nRESULT ${JSON.stringify({ mb: MB, seconds, mbps: MB / seconds, path: info.path })}`);
    await browser.close();
    process.exit(0);
  }
}

log('超时');
await browser.close();
process.exit(2);
