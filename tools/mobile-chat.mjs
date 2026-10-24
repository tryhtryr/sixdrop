/**
 * 手机端换行行为：触屏设备上回车只换行，发送靠按钮。
 *   node tools/mobile-chat.mjs
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, devices } from 'playwright-core';

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
  const phone = await browser.newContext({
    ...devices['iPhone 13'],
    defaultBrowserType: undefined,
  });
  const deskCtx = await browser.newContext();

  const sender = await phone.newPage();
  const receiver = await deskCtx.newPage();

  await sender.goto(BASE);
  await receiver.goto(BASE);

  // 触屏判定
  const touch = await sender.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
  assert.ok(touch, '模拟的设备没有被识别为触屏');
  const ph = await sender.locator('#chat-input').getAttribute('placeholder');
  assert.match(ph, /可换行/, `手机端占位提示不对: ${ph}`);
  step(`触屏判定通过，提示文案：${ph}`);

  await sender.tap('#tab-text');
  await sender.tap('#text-start');
  await sender.waitForFunction(
    () => /^[2-9A-HJ-NP-Z]{6}$/.test(document.getElementById('room-code').textContent.trim()),
    null,
    { timeout: 20000 },
  );
  const code = (await sender.locator('#room-code').textContent()).trim();
  await receiver.fill('#code', code);
  await receiver.press('#code', 'Enter');

  await sender.waitForSelector('#view-chat:not([hidden])', { timeout: 30000 });
  await receiver.waitForSelector('#view-chat:not([hidden])', { timeout: 30000 });
  step('两端进入对话');

  // 手机上按回车：只换行，绝不发送
  await sender.fill('#chat-input', '第一行');
  await sender.press('#chat-input', 'Enter');
  await sender.type('#chat-input', '第二行');

  const draft = await sender.inputValue('#chat-input');
  assert.equal(draft, '第一行\n第二行', `回车没有换行: ${JSON.stringify(draft)}`);
  assert.equal(await sender.locator('#chat-list li').count(), 0, '手机上回车不该直接发送');
  step('手机上回车只换行');

  // 点按钮才发
  await sender.tap('#chat-form button[type="submit"]');
  await receiver.waitForFunction(
    () => [...document.querySelectorAll('#chat-list li')].some((li) => li.textContent.includes('第二行')),
    null,
    { timeout: 15000 },
  );
  const lines = await receiver.evaluate(() => {
    const li = [...document.querySelectorAll('#chat-list li')].find((x) => x.textContent.includes('第二行'));
    return li.textContent.split('\n').length;
  });
  assert.equal(lines, 2, '接收端没收到两行');
  step('点发送后两行完整送达');

  console.log('\n手机端换行通过');
} catch (err) {
  console.error('\n手机端换行失败:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
