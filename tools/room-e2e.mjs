/**
 * 房间模型（切片 2）本地验收：
 *   自动建房 → 进房 → 传文件 → 回待选 → 拒绝后仍在房间 → 文本免验证
 *   node tools/room-e2e.mjs
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const step = (m) => console.log(`  · ${m}`);
const browser = await chromium.launch({ executablePath: EDGE, headless: true });

try {
  const a = await browser.newPage();
  const b = await browser.newPage();
  const errs = [];
  for (const [n, p] of [['A', a], ['B', b]]) {
    p.on('pageerror', (e) => errs.push(`${n}: ${e.message}`));
  }
  await b.addInitScript(() => {
    window.showSaveFilePicker = undefined;
    window.showDirectoryPicker = undefined;
    window.__blobs = [];
    const o = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (x) => {
      window.__blobs.push(x.size);
      return o(x);
    };
  });

  await a.goto(BASE);
  await a.waitForSelector('#view-room:not([hidden])', { timeout: 15000 });
  // 建房是异步的，等码真正出来
  await a.waitForFunction(
    () => /^[2-9A-HJ-NP-Z]{6}$/.test(document.getElementById('room-code').textContent.trim()),
    null,
    { timeout: 20000 },
  );
  const code = (await a.locator('#room-code').textContent()).trim();
  step(`打开即进房间，取件码 ${code}`);
  step(`状态：${await a.locator('#link-state').textContent()}`);

  // 先选文件，再让对方进来
  await a.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(6 * 1024 * 1024)], 'batch1.bin'));
    const i = document.getElementById('file');
    i.files = dt.files;
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  step('A 先选了文件');

  await b.goto(`${BASE}/?c=${code}`);
  await a.waitForFunction(
    () => document.getElementById('link-state').textContent.includes('已直连'),
    null,
    { timeout: 25000 },
  );
  step('两端已直连');

  await b.waitForSelector('#file-ask:not([hidden])', { timeout: 20000 });
  await b.click('#accept');
  await b.waitForFunction(() => window.__blobs.length >= 1, null, { timeout: 30000 });
  step(`第一批送达 ${await b.evaluate(() => window.__blobs[0])} 字节`);

  await b.waitForSelector('#file-idle:not([hidden])', { timeout: 10000 });
  step('接收方传完回到可继续状态');

  // 第二批：拒绝路径
  await a.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(1024 * 1024)], 'batch2.bin'));
    const i = document.getElementById('file');
    i.files = dt.files;
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await b.waitForSelector('#file-ask:not([hidden])', { timeout: 20000 });
  await b.click('#decline');
  await b.waitForTimeout(600);
  const bothInRoom = await Promise.all([
    a.evaluate(() => !document.getElementById('view-room').hidden),
    b.evaluate(() => !document.getElementById('view-room').hidden),
  ]);
  if (!bothInRoom[0] || !bothInRoom[1]) throw new Error('拒绝后有人掉出了房间');
  step('拒绝后两端都还在房间里');

  // 文本：不需要重新建房
  await a.click('#room-tab-text');
  await b.click('#room-tab-text');
  await a.fill('#chat-input', '房间里的消息');
  await a.press('#chat-input', 'Enter');
  await b.waitForFunction(
    () => [...document.querySelectorAll('#chat-list li')].some((li) => li.textContent.includes('房间里的消息')),
    null,
    { timeout: 15000 },
  );
  const codeUnchanged = (await a.locator('#room-code').textContent()).trim() === code;
  step(`文本送达，取件码未变：${codeUnchanged}`);

  console.log('  页面错误:', errs.length ? errs.join(' | ') : '无');
  console.log('\n房间模型通过');
} catch (err) {
  console.error('\n房间模型失败:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
