/**
 * 验证「打洞失败时，文本还能发」：
 * 把 RTCPeerConnection 打掉，两端应自动退到信令通道继续聊天。
 *   node tools/text-fallback.mjs
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const step = (m) => console.log(`  · ${m}`);
const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });

try {
  const sender = await browser.newPage();
  const receiver = await browser.newPage();

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

  await sender.click('#tab-text');
  await sender.click('#text-start');
  await sender.waitForFunction(
    () => /^[2-9A-HJ-NP-Z]{6}$/.test(document.getElementById('room-code').textContent.trim()),
    null,
    { timeout: 20000 },
  );
  const code = (await sender.locator('#room-code').textContent()).trim();
  step(`取件码 ${code}`);

  await receiver.fill('#code', code);
  await receiver.press('#code', 'Enter');

  await sender.waitForSelector('#view-chat:not([hidden])', { timeout: 30000 });
  await receiver.waitForSelector('#view-chat:not([hidden])', { timeout: 30000 });
  step('两端都退到了文本兜底');

  const note = await sender.locator('#chat-note').textContent();
  assert.match(note, /服务器转发/, `兜底提示不对: ${note}`);

  await sender.fill('#chat-input', '直连挂了，这条是经服务器转的');
  await sender.press('#chat-input', 'Enter');
  await receiver.waitForFunction(
    () => [...document.querySelectorAll('#chat-list li')].some((li) => li.textContent.includes('经服务器转的')),
    null,
    { timeout: 15000 },
  );
  step('接收方收到兜底消息');

  await receiver.fill('#chat-input', '我也收到了，能聊就行');
  await receiver.press('#chat-input', 'Enter');
  await sender.waitForFunction(
    () => [...document.querySelectorAll('#chat-list li')].some((li) => li.textContent.includes('能聊就行')),
    null,
    { timeout: 15000 },
  );
  step('反向也通');

  console.log('\n文本兜底通过');
} catch (err) {
  console.error('\n文本兜底失败:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
