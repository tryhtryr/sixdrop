/**
 * 验证「接收方主动请求中转」：
 * 接收端的 RTCPeerConnection 被打掉 → 收到 offer 后报错 → 失败页 → 点「改用中转」
 * → 发送方收到 relay-request 自动上传 → 接收方拿到链接并下载。
 */
import assert from 'node:assert/strict';
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

const step = (msg) => console.log(`  · ${msg}`);
const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });

try {
  const senderCtx = await browser.newContext();
  const receiverCtx = await browser.newContext();
  const sender = await senderCtx.newPage();
  const receiver = await receiverCtx.newPage();

  // 只打掉接收端的 P2P：它会收到 offer 然后报错，发送端保持真实实现
  await receiver.addInitScript(() => {
    window.RTCPeerConnection = class {
      constructor() {
        throw new Error('p2p disabled for test');
      }
    };

    // 记录进度文案出现过的所有版本，避免被最终状态覆盖导致断言失败
    window.__stats = [];
    window.addEventListener('DOMContentLoaded', () => {
      const el = document.getElementById('relay-stats');
      new MutationObserver(() => {
        window.__stats.push(el.textContent);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });
  });

  await sender.goto(BASE);
  await receiver.goto(BASE);

  await sender.evaluate(() => {
    const dt = new DataTransfer();
    for (const [name, size] of [
      ['from-receiver-a.bin', 2 * 1024 * 1024],
      ['from-receiver-b.bin', 1024 * 1024],
    ]) {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i += 1) bytes[i] = (i * 13 + 5) & 255;
      dt.items.add(new File([bytes], name, { type: 'application/octet-stream' }));
    }
    const input = document.getElementById('file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await sender.waitForFunction(
    () => /^[2-9A-HJ-NP-Z]{6}$/.test(document.getElementById('room-code').textContent.trim()),
    null,
    { timeout: 20000 },
  );
  const code = (await sender.locator('#room-code').textContent()).trim();
  step(`取件码 ${code}`);

  await receiver.fill('#code', code);
  await receiver.press('#code', 'Enter');

  await receiver.waitForSelector('#view-error:not([hidden])', { timeout: 30000 });
  step('接收方进入失败页');

  assert.ok(await receiver.locator('#use-relay').isVisible(), '接收方失败页没有「改用中转」');

  await receiver.click('#use-relay');
  await receiver.waitForFunction(
    () => document.getElementById('relay-stats').textContent.includes('等待'),
    null,
    { timeout: 10000 },
  );
  step('接收方已发出中转请求');

  await receiver.waitForFunction(
    () => document.querySelectorAll('#relay-list a').length === 2,
    null,
    { timeout: 90000 },
  );
  step('发送方自动上传完成，接收方拿到两条链接');

  const hrefs = await receiver.$$eval('#relay-list a', (as) => as.map((a) => a.href));
  const sawProgress = await receiver.evaluate(() =>
    window.__stats.some((t) => t && t.includes('对方正在上传')),
  );
  assert.ok(sawProgress, '接收方从未看到上传进度');

  const size = await receiver.evaluate(async (url) => {
    const res = await fetch(url);
    return res.ok ? (await res.arrayBuffer()).byteLength : -res.status;
  }, hrefs[0]);
  assert.equal(size, 2 * 1024 * 1024, '下载文件大小不对');
  step(`接收方看到过上传进度，下载校验通过 · ${size} B`);

  console.log('\n接收方发起的中转链路通过');
} catch (err) {
  console.error('\n接收方发起的中转链路失败:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
