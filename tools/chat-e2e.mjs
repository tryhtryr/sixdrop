/**
 * 端到端验证「只发文字」模式：两个真实浏览器页面互发消息。
 *   node tools/chat-e2e.mjs
 *   BASE_URL=https://sixdrop.dev node tools/chat-e2e.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const step = (msg) => console.log(`  · ${msg}`);

let server = null;
async function ensureServer() {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  const url = 'http://127.0.0.1:8787';
  try {
    await fetch(url, { signal: AbortSignal.timeout(800) });
    return url;
  } catch {
    /* 自己拉一个 */
  }
  server = spawn(process.execPath, [resolve(HERE, 'dev-server.mjs')], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, PORT: '8787' },
  });
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (res.ok) return url;
    } catch {
      /* 等 */
    }
  }
  throw new Error('dev-server 启动超时');
}

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });

try {
  const base = await ensureServer();
  const sender = await browser.newPage();
  const receiver = await browser.newPage();

  await sender.goto(base);
  await receiver.goto(base);

  await sender.click('#tab-text');
  await sender.waitForSelector('#panel-text:not([hidden])', { timeout: 5000 });
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
  step('两端都进入对话');

  await sender.fill('#chat-input', '你好，这是一条测试消息');
  await sender.press('#chat-input', 'Enter');
  await receiver.waitForFunction(
    () => [...document.querySelectorAll('#chat-list li')].some((li) => li.textContent.includes('测试消息')),
    null,
    { timeout: 15000 },
  );
  step('接收方收到发送方的消息');

  await receiver.fill('#chat-input', '收到，回你一句');
  await receiver.press('#chat-input', 'Enter');
  await sender.waitForFunction(
    () => [...document.querySelectorAll('#chat-list li')].some((li) => li.textContent.includes('回你一句')),
    null,
    { timeout: 15000 },
  );
  step('发送方收到回复');

  const mine = await sender.locator('#chat-list li.mine').count();
  const theirs = await sender.locator('#chat-list li.theirs').count();
  assert.equal(mine, 1, '发送方自己的消息应标为 mine');
  assert.equal(theirs, 1, '对方消息应标为 theirs');

  console.log('\n文本消息链路通过');
} catch (err) {
  console.error('\n文本消息链路失败:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  server?.kill();
}
