/**
 * 端到端验证「打洞失败 → 改用中转」这条 UI 路径。
 * 把 RTCPeerConnection 打掉，强制走失败分支，然后点按钮、看两边是否都拿到链接。
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

  // 让 P2P 必然失败，逼出「改用中转」
  const killP2P = () => {
    window.RTCPeerConnection = class {
      constructor() {
        throw new Error('p2p disabled for test');
      }
    };
  };
  await sender.addInitScript(killP2P);
  await receiver.addInitScript(killP2P);

  await sender.goto(BASE);
  await receiver.goto(BASE);

  await sender.evaluate(() => {
    const dt = new DataTransfer();
    for (const [name, size] of [
      ['relay-a.bin', 512 * 1024],
      ['relay-b.bin', 256 * 1024],
    ]) {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i += 1) bytes[i] = (i * 7 + 11) & 255;
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

  await sender.waitForSelector('#view-error:not([hidden])', { timeout: 30000 });
  step('发送方进入失败页');

  const relayVisible = await sender.locator('#use-relay').isVisible();
  assert.ok(relayVisible, '发送方的失败页没有出现「改用中转」按钮');

  // 接收方手上没有文件，但同样要能请对方走中转
  await receiver.waitForSelector('#view-error:not([hidden])', { timeout: 30000 });
  assert.ok(
    await receiver.locator('#use-relay').isVisible(),
    '接收方的失败页没有出现「改用中转」按钮',
  );
  step('接收方也能看到改用中转');

  await sender.click('#use-relay');
  await sender.waitForFunction(
    () => document.querySelectorAll('#relay-list a').length === 2,
    null,
    { timeout: 60000 },
  );
  step('发送方上传完成，两条链接已生成');

  await receiver.waitForFunction(
    () => document.querySelectorAll('#relay-list a').length === 2,
    null,
    { timeout: 60000 },
  );
  step('接收方通过房间收到了链接');

  const hrefs = await receiver.$$eval('#relay-list a', (as) => as.map((a) => a.href));
  assert.ok(hrefs.every((h) => h.includes('.r2.cloudflarestorage.com/')), '链接不是 R2 预签名地址');

  const size = await receiver.evaluate(async (url) => {
    const res = await fetch(url);
    return res.ok ? (await res.arrayBuffer()).byteLength : -res.status;
  }, hrefs[0]);
  assert.equal(size, 512 * 1024, '下载下来的文件大小不对');
  step(`接收方成功下载第一个文件 · ${size} B`);

  console.log('\n中转 UI 链路通过');
} catch (err) {
  console.error('\n中转 UI 链路失败:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
