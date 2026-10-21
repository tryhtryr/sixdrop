/**
 * 房间模型验收（合并 UI 之后）：一个房间从头用到尾，码不变。
 *
 *   node tools/room-e2e.mjs
 *   BASE_URL=https://sixdrop.dev node tools/room-e2e.mjs
 *
 * 覆盖 docs/room-model-spec.md 第八节的用例：
 *   自动建房 · 输码加入 · 两个标签来回切 · 拒绝不留坑 · 多批文件 · 房间里发文本 · 离开
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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

const CODE_RE = /^[2-9A-HJ-NP-Z]{6}$/;
const step = (msg) => console.log(`  · ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fillBytes = (size, seed) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7 + seed * 13) & 255;
  return bytes;
};

/* ---------------- 起服务 ---------------- */

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

/* ---------------- 页面小工具 ---------------- */

const visible = (page, sel) => page.locator(sel).isVisible();
const codeOf = async (page) => (await page.locator('#room-code').textContent()).trim();

async function pickFiles(page, files) {
  await page.evaluate((list) => {
    const dt = new DataTransfer();
    for (const f of list) {
      const bytes = new Uint8Array(f.size);
      for (let i = 0; i < f.size; i += 1) bytes[i] = (i * 31 + 7 + f.seed * 13) & 255;
      dt.items.add(new File([bytes], f.name, { type: 'application/octet-stream' }));
    }
    const input = document.getElementById('file-wait');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, files);
}

/** 房间必须还在，而且码没变 */
async function assertRoomIntact(page, code, where) {
  assert.ok(await visible(page, '#view-room'), `${where}：房间视图不见了`);
  assert.equal(await codeOf(page), code, `${where}：取件码变了`);
}

async function main() {
  const base = await ensureServer();
  const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
  const errors = [];

  try {
    const senderCtx = await browser.newContext();
    const receiverCtx = await browser.newContext();
    const sender = await senderCtx.newPage();
    const receiver = await receiverCtx.newPage();

    for (const [name, page] of [
      ['sender', sender],
      ['receiver', receiver],
    ]) {
      page.on('pageerror', (err) => errors.push(`${name} pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`${name} console: ${msg.text()}`);
      });
    }

    // 接收端走内存 Blob 分支，并收集结果
    await receiver.addInitScript(() => {
      window.showSaveFilePicker = undefined;
      window.showDirectoryPicker = undefined;
      window.__blobs = [];
      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        window.__blobs.push(blob);
        return original(blob);
      };
    });

    /* ---- 1. 打开就有码（自动建房） ---- */
    await sender.goto(base);
    await sender.waitForFunction(
      () => /^[2-9A-HJ-NP-Z]{6}$/.test(document.getElementById('room-code').textContent.trim()),
      null,
      { timeout: 30000 },
    );
    const code = await codeOf(sender);
    assertRoomIntact(sender, code, '建房后');
    assert.ok(await visible(sender, '#file-idle'), '建房后应该停在文件面板的空闲态');
    step(`自动建房 ${code}`);

    /* ---- 2. 两个标签随时切，码不变 ---- */
    await sender.click('#tab-text');
    assert.ok(await visible(sender, '#panel-text'), '点了文本标签却没切到文本面板');
    await sender.click('#tab-file');
    assert.ok(await visible(sender, '#file-idle'), '切回文件标签后不是空闲态');
    assertRoomIntact(sender, code, '切标签后');
    step('标签来回切，房间和码都在');

    /* ---- 3. 房主先选文件，等对方进来 ---- */
    await pickFiles(sender, [{ name: 'room-a.bin', size: 1_500_000, seed: 4 }]);
    await sender.waitForFunction(
      () => !document.getElementById('wait-files').hidden,
      null,
      { timeout: 5000 },
    );
    step('房主已选文件，等待对方');

    /* ---- 4. 深链加入，接收方看到确认框 ---- */
    await receiver.goto(`${base}/?c=${code}`);
    await receiver.waitForSelector('#file-ask:not([hidden])', { timeout: 30000 });
    assert.equal(await receiver.locator('#ask-name').textContent(), 'room-a.bin');
    assertRoomIntact(receiver, code, '深链加入后');
    step('对方进房，确认框出现');

    /* ---- 5. 拒绝只退这一批，房间留着 ---- */
    await receiver.click('#decline');
    await receiver.waitForSelector('#file-idle:not([hidden])', { timeout: 10000 });
    assertRoomIntact(receiver, code, '拒绝后');
    await sender.waitForFunction(
      () => document.getElementById('wait-sub').textContent.includes('拒绝'),
      null,
      { timeout: 20000 },
    );
    assertRoomIntact(sender, code, '收到拒绝后');
    assert.ok(await visible(sender, '#file-idle'), '被拒绝后房主应该回到空闲态');
    step('拒绝：两边都留在原房间');

    /* ---- 6. 同一房间换一批文件，接收方接受 ---- */
    await pickFiles(sender, [{ name: 'room-b.bin', size: 2_200_000, seed: 5 }]);
    await receiver.waitForSelector('#file-ask:not([hidden])', { timeout: 30000 });
    assert.equal(await receiver.locator('#ask-name').textContent(), 'room-b.bin');
    await receiver.click('#accept');
    await receiver.waitForFunction(() => window.__blobs.length >= 1, null, { timeout: 120000 });

    const first = await receiver.evaluate(async () => {
      const blob = window.__blobs[0];
      const buf = await blob.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return {
        size: blob.size,
        hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
      };
    });
    const expectedFirst = createHash('sha256').update(fillBytes(2_200_000, 5)).digest('hex');
    assert.equal(first.size, 2_200_000, '第一个文件大小不对');
    assert.equal(first.hash, expectedFirst, '第一个文件哈希不对');
    await sender.waitForFunction(
      () => document.getElementById('xfer-sub').textContent.includes('完成'),
      null,
      { timeout: 30000 },
    );
    step('第二批文件传完，哈希一致');

    /* ---- 7. 传完点「返回」：回到房间而不是回首页 ---- */
    await sender.click('#back');
    await sender.waitForSelector('#file-idle:not([hidden])', { timeout: 10000 });
    assertRoomIntact(sender, code, '传完点返回后');
    step('返回按钮回到房间，码没变');

    /* ---- 8. 第三批：验证发送锁真的放开了 ---- */
    await pickFiles(sender, [{ name: 'room-c.bin', size: 900_000, seed: 6 }]);
    await receiver.waitForSelector('#file-ask:not([hidden])', { timeout: 30000 });
    await receiver.click('#accept');
    await receiver.waitForFunction(() => window.__blobs.length >= 2, null, { timeout: 60000 });
    const second = await receiver.evaluate(async () => {
      const buf = await window.__blobs[1].arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return {
        size: buf.byteLength,
        hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
      };
    });
    assert.equal(second.size, 900_000, '第二批（第三批文件）大小不对');
    assert.equal(
      second.hash,
      createHash('sha256').update(fillBytes(900_000, 6)).digest('hex'),
      '第二批（第三批文件）哈希不对',
    );
    step('同一房间第三批也发得出去（发送锁已释放）');

    /* ---- 9. 房间里发文本，不换房间不换码 ---- */
    await sender.click('#tab-text');
    await sender.fill('#chat-input', '房间里发的消息');
    await sender.press('#chat-input', 'Enter');
    await receiver.waitForFunction(
      () => [...document.querySelectorAll('#chat-list li')].some((li) => li.textContent.includes('房间里发的消息')),
      null,
      { timeout: 15000 },
    );
    assert.ok(await visible(receiver, '#panel-text'), '收到文本后应该切到文本面板');
    assertRoomIntact(receiver, code, '收到文本后');
    assert.equal(await codeOf(sender), code, '发文本后取件码变了');

    await receiver.fill('#chat-input', '房间还在，回你一句');
    await receiver.press('#chat-input', 'Enter');
    await sender.waitForFunction(
      () => [...document.querySelectorAll('#chat-list li')].some((li) => li.textContent.includes('回你一句')),
      null,
      { timeout: 15000 },
    );
    assertRoomIntact(sender, code, '互发文本后');

    // 从文本面板切回文件面板：房间还在，文件面板保留上次的状态
    await receiver.click('#tab-file');
    assert.ok(await visible(receiver, '#panel-file'), '切回文件标签后文件面板没出来');
    assert.ok(await visible(receiver, '#file-progress'), '传完后切回来应该还看得到文件列表和进度');
    assertRoomIntact(receiver, code, '文本切回文件后');
    step('同一个房间里聊完还能切回文件面板');

    /* ---- 10. 离开：回首页，房间不再显示 ---- */
    await sender.click('#cancel');
    await sender.waitForSelector('#view-start:not([hidden])', { timeout: 10000 });
    assert.equal(await sender.locator('#view-room').isVisible(), false, '离开后房间还显示着');
    step('离开回到首页');

    if (errors.length) throw new Error('页面报错:\n' + errors.join('\n'));
    console.log('\n房间模型验收通过');
  } finally {
    await browser.close();
    server?.kill();
  }
}

try {
  await main();
} catch (err) {
  console.error('\n房间模型验收失败:', err.message);
  process.exitCode = 1;
}
