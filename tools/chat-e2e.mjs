/**
 * 端到端验证「发送文本」：两个真实浏览器页面互发消息。
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

  // 大厅：拿到自己的取件码；对方输码加入后两边一起进房间
  await sender.waitForFunction(
    () => /^[2-9A-HJ-NP-Z]{6}$/.test(document.getElementById('lobby-code').textContent.trim()),
    null,
    { timeout: 20000 },
  );
  const code = (await sender.locator('#lobby-code').textContent()).trim();
  step(`取件码 ${code}`);

  await receiver.fill('#code', code);
  await receiver.press('#code', 'Enter');

  await sender.waitForSelector('#view-room:not([hidden])', { timeout: 30000 });
  await receiver.waitForSelector('#view-room:not([hidden])', { timeout: 30000 });

  // 等直连通道打开（此时发文本才走得到对方）
  for (const [name, page] of [
    ['发送方', sender],
    ['接收方', receiver],
  ]) {
    await page.waitForFunction(
      () => document.getElementById('room-status').textContent.includes('已直连'),
      null,
      { timeout: 30000 },
    );
    step(`${name}已直连`);
  }

  // 房间里的第二个标签就是聊天
  await sender.click('#tab-text');
  await receiver.click('#tab-text');
  await sender.waitForSelector('#panel-text:not([hidden])', { timeout: 5000 });
  await receiver.waitForSelector('#panel-text:not([hidden])', { timeout: 5000 });
  step('两端都切到「发送文本」标签');

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

  assert.equal(await sender.locator('#chat-list li.mine').count(), 1, '发送方自己的消息应标为 mine');
  assert.equal(await sender.locator('#chat-list li.theirs').count(), 1, '对方消息应标为 theirs');

  // 多行文本：换行必须原样保留，粘贴也不能吞掉
  await sender.fill('#chat-input', '第一行\n第二行\n\n第四行');
  await sender.press('#chat-input', 'Enter');
  await receiver.waitForFunction(
    () => [...document.querySelectorAll('#chat-list li')].some((li) => li.textContent.includes('第四行')),
    null,
    { timeout: 15000 },
  );
  const multi = await receiver.evaluate(() => {
    const li = [...document.querySelectorAll('#chat-list li')].find((x) => x.textContent.includes('第四行'));
    return {
      text: li.textContent,
      ws: getComputedStyle(li).whiteSpace,
      lines: li.textContent.split('\n').length,
      height: li.getBoundingClientRect().height,
    };
  });
  assert.equal(multi.lines, 4, `换行没保留，实际拿到 ${multi.lines} 行: ${JSON.stringify(multi.text)}`);
  assert.equal(multi.ws, 'pre-wrap', '气泡的空白处理不对');
  assert.ok(multi.height > 70, `多行气泡高度异常: ${multi.height}`);
  step(`多行文本通过（${multi.lines} 行，气泡高 ${Math.round(multi.height)}px）`);

  // Shift+回车只换行，不发送
  const beforeCount = await sender.locator('#chat-list li.mine').count();
  await sender.fill('#chat-input', '换行测试');
  await sender.press('#chat-input', 'Shift+Enter');
  await sender.type('#chat-input', '第二句');
  const draft = await sender.inputValue('#chat-input');
  assert.ok(draft.includes('\n'), 'Shift+回车没有插入换行');
  assert.equal(await sender.locator('#chat-list li.mine').count(), beforeCount, 'Shift+回车不该发出去');
  step('Shift+回车只换行不发送');

  // 聊完切回文件标签，房间和码都还在
  await sender.click('#tab-file');
  assert.ok(await sender.locator('#panel-file').isVisible(), '切回文件标签后文件面板没出来');
  assert.equal((await sender.locator('#room-code').textContent()).trim(), code, '聊天后取件码变了');
  step('切回文件面板，房间和码都在');

  console.log('\n文本消息链路通过');
} catch (err) {
  console.error('\n文本消息链路失败:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  server?.kill();
}
