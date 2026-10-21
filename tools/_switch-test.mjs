import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const b = await chromium.launch({ executablePath: EDGE, headless: true });
const sender = await b.newPage();
const receiver = await b.newPage();
const errors = [];
for (const [n, p] of [['sender', sender], ['receiver', receiver]]) {
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${n} console: ${m.text()}`);
  });
}
await receiver.addInitScript(() => {
  window.showSaveFilePicker = undefined;
  window.showDirectoryPicker = undefined;
  window.__blobs = [];
  const o = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    window.__blobs.push(blob);
    return o(blob);
  };
});

const state = (page) =>
  page.evaluate(() => ({
    text: !document.getElementById('panel-text').hidden,
    file: !document.getElementById('panel-file').hidden,
    ask: !document.getElementById('file-ask').hidden,
    progress: !document.getElementById('file-progress').hidden,
    blobs: window.__blobs ? window.__blobs.length : null,
    stats: document.getElementById('xfer-stats').textContent,
  }));

await sender.goto(BASE);
await receiver.goto(BASE);
await sender.waitForFunction(() => /^[2-9A-HJ-NP-Z]{6}$/.test(document.getElementById('lobby-code').textContent.trim()));
const code = (await sender.locator('#lobby-code').textContent()).trim();
await receiver.fill('#code', code);
await receiver.press('#code', 'Enter');
await sender.waitForSelector('#view-room:not([hidden])');
await sender.waitForFunction(() => document.getElementById('room-status').textContent.includes('已直连'));

// 两个文件
await sender.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(4 * 1024 * 1024)], 'a.bin'));
  dt.items.add(new File([new Uint8Array(24 * 1024 * 1024)], 'b.bin'));
  const i = document.getElementById('file-wait');
  i.files = dt.files;
  i.dispatchEvent(new Event('change', { bubbles: true }));
});

// 1) 确认框还在的时候切文本
await receiver.waitForSelector('#file-ask:not([hidden])');
await receiver.click('#tab-text');
await new Promise((r) => setTimeout(r, 120));
console.log('ask pending -> text:', await state(receiver));
await receiver.click('#tab-file');
await receiver.click('#accept');

// 2) 接收中切文本（多文件，中途还有下一个 meta）
await new Promise((r) => setTimeout(r, 500));
await receiver.click('#tab-text');
await new Promise((r) => setTimeout(r, 120));
console.log('receiving -> text:', await state(receiver));

// 3) 发送中切文本
await sender.click('#tab-text');
await new Promise((r) => setTimeout(r, 120));
console.log('sending -> text:', await state(sender));

// 4) 两边都在文本标签时互发
await receiver.fill('#chat-input', '接收中发的消息');
await receiver.press('#chat-input', 'Enter');
await sender.waitForFunction(
  () => [...document.querySelectorAll('#chat-list li')].some((li) => li.textContent.includes('接收中发的消息')),
  null,
  { timeout: 10000 },
);
console.log('sender sees message, state:', await state(sender));

await sender.fill('#chat-input', '发送中回你一句');
await sender.press('#chat-input', 'Enter');
await receiver.waitForFunction(
  () => [...document.querySelectorAll('#chat-list li')].some((li) => li.textContent.includes('发送中回你一句')),
  null,
  { timeout: 10000 },
);

// 5) 传完看还在哪
await receiver.waitForFunction(() => window.__blobs.length >= 2, null, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 400));
console.log('after 2 files:', await state(receiver));
console.log('sender after:', await state(sender));
console.log('errors:', errors);
await b.close();
