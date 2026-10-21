/**
 * 真实接收端：加入对方建的房间，接收文件并记录实测数据。
 *   node tools/measure-receive.mjs D7NKL5
 *
 * 头部无头浏览器弹不出保存对话框，所以这里走内存分支；
 * 只用它来测「传输耗时」，文件本身不落盘。
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const code = (process.argv[2] || '').toUpperCase();
if (!/^[2-9A-HJ-NP-Z]{6}$/.test(code)) {
  console.error('用法: node tools/measure-receive.mjs <6位取件码>');
  process.exit(1);
}

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

// 让它走内存分支，同时把到手的 Blob 记下来
await page.addInitScript(() => {
  window.showSaveFilePicker = undefined;
  window.showDirectoryPicker = undefined;
  window.__blobs = [];
  const original = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    window.__blobs.push({ size: blob.size });
    return original(blob);
  };
});

await page.goto('https://sixdrop.dev', { waitUntil: 'domcontentloaded' });
log(`打开首页，输入取件码 ${code}`);
await page.fill('#code', code);
await page.press('#code', 'Enter');

// 等对方发文件
log('等待对方发起传输…');
await page.waitForSelector('#view-ask:not([hidden])', { timeout: 180000 });

const name = (await page.locator('#ask-name').textContent()).trim();
const sizeLine = (await page.locator('#ask-size').textContent()).trim();
log(`对方要发：${name}`);
log(`文件信息：${sizeLine}`);

// 解析「共 N 个文件、X MB」或「Y MB」
const sizeMatch = sizeLine.match(/([\d.]+)\s*(B|KB|MB|GB)/i);
const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
const bytes = sizeMatch ? Math.round(parseFloat(sizeMatch[1]) * units[sizeMatch[2].toUpperCase()]) : 0;

// 连接建立后页面会显示链路类型，先抓一下
await page.waitForTimeout(800);
const linkInfo = await page.evaluate(() => {
  const path = document.getElementById('path')?.textContent || '';
  const verify = document.getElementById('verify-code')?.textContent || '';
  return { path, verify };
});
log(`链路：${linkInfo.path || '(未显示)'} · 校验码 ${linkInfo.verify || '-'}`);

const started = Date.now();
await page.click('#accept');
log('已点接收，开始计时');

// 轮询进度，直到出现返回按钮（传输结束）
let last = '';
let stuck = 0;
while (Date.now() - started < 600000) {
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => ({
    stats: document.getElementById('xfer-stats')?.textContent || '',
    sub: document.getElementById('xfer-sub')?.textContent || '',
    back: !document.getElementById('back')?.hidden,
    path: document.getElementById('path')?.textContent || '',
    verify: document.getElementById('verify-code')?.textContent || '',
  }));

  if (info.stats !== last) {
    last = info.stats;
    stuck = 0;
    process.stdout.write(`\r  ${info.stats}`.padEnd(60));
  } else if (++stuck > 60) {
    log('超过 30 秒没有进度变化，可能是打洞失败或对方中断');
    break;
  }

  if (info.back) {
    const seconds = (Date.now() - started) / 1000;
    console.log('');
    log(`传输结束 · ${seconds.toFixed(2)} 秒`);
    log(`速度 · ${(bytes / 1024 / 1024 / seconds).toFixed(1)} MB/s`);
    log(`链路 · ${info.path || '(未知)'}`);
    log(`校验码 · ${info.verify || '(无)'}`);
    const got = await page.evaluate(() => window.__blobs.reduce((n, b) => n + b.size, 0));
    log(`实际收到 · ${(got / 1024 / 1024).toFixed(1)} MB（期望 ${(bytes / 1024 / 1024).toFixed(1)} MB）`);
    console.log('\nRESULT ' + JSON.stringify({ bytes, seconds, mbps: bytes / 1024 / 1024 / seconds, path: info.path, ok: got === bytes }));
    await browser.close();
    process.exit(0);
  }
}

console.log('');
log('超时，没有收到完成信号');
await browser.close();
process.exit(2);
