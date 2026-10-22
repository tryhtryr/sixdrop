/**
 * 房间模型验收：大厅只给码，输码进房间，房间里两个标签。
 *
 *   node tools/room-e2e.mjs
 *   BASE_URL=https://sixdrop.dev node tools/room-e2e.mjs
 *
 * 覆盖：
 *   打开只有取件码 + 输码框 · 输码进房间 · 房主自动进房间 · 两个标签来回切 ·
 *   拒绝不留坑 · 多批文件 · 房间里发文本 · 离开回大厅
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
const roomCode = async (page) => (await page.locator('#room-code').textContent()).trim();
const lobbyCode = async (page) => (await page.locator('#lobby-code').textContent()).trim();

async function waitLobbyCode(page) {
  await page.waitForFunction(
    () => /^[2-9A-HJ-NP-Z]{6}$/.test(document.getElementById('lobby-code').textContent.trim()),
    null,
    { timeout: 30000 },
  );
  return lobbyCode(page);
}

/** 在大厅输入对方的码加入（会整页跳 /?c=） */
async function joinByCode(page, code) {
  await page.click('#pair-open');
  await page.fill('#code', code);
  await page.press('#code', 'Enter');
  await page.waitForSelector('#view-room:not([hidden])', { timeout: 30000 });
}

async function waitConnected(page) {
  await page.waitForFunction(
    () => document.getElementById('room-status').textContent.includes('已直连'),
    null,
    { timeout: 30000 },
  );
}

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
  assert.equal(await roomCode(page), code, `${where}：取件码变了`);
}

async function blobAt(page, index) {
  return page.evaluate(async (i) => {
    const blob = window.__blobs[i];
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return {
      size: buf.byteLength,
      hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    };
  }, index);
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

    /* ---- 1. 打开页面：只有取件码 + 输码框 ---- */
    await sender.goto(base);
    const code = await waitLobbyCode(sender);
    assert.match(code, CODE_RE, '大厅里的取件码格式不对');
    assert.ok(await visible(sender, '#view-lobby'), '打开页面应该停在大厅');
    assert.equal(await sender.locator('#view-room').isVisible(), false, '还没进房间就显示房间了');
    assert.equal(await sender.locator('#view-lobby input[type=file]').count(), 0, '大厅不该有文件选择框');
    assert.equal(await sender.locator('#view-lobby .tab').count(), 0, '大厅不该有标签页');
    step(`打开只有取件码 ${code}`);

    /* ---- 2. 输码加入：直接进房间 ---- */
    await receiver.goto(base);
    const receiverOwn = await waitLobbyCode(receiver);
    assert.notEqual(receiverOwn, code, '两个页面拿到了同一个码');
    await joinByCode(receiver, code);
    assert.ok(await visible(receiver, '#file-idle'), '进房间后应该停在文件面板');
    assert.equal(await roomCode(receiver), code, '房间里的码不是输进去的那个');
    step('输码直接进入房间');

    /* ---- 3. 房主自动进房间 ---- */
    await sender.waitForSelector('#view-room:not([hidden])', { timeout: 30000 });
    assert.equal(await roomCode(sender), code, '房主进房间后码变了');
    assert.ok(await visible(sender, '#file-idle'), '房主进房间后不是文件面板');
    step('对方进房，房主也自动进房间');

    await waitConnected(sender);
    await waitConnected(receiver);
    step('直连建立');

    /* ---- 4. 两个标签随时切，码不变 ---- */
    await sender.click('#tab-text');
    assert.ok(await visible(sender, '#panel-text'), '点了文本标签却没切到文本面板');
    await sender.click('#tab-file');
    assert.ok(await visible(sender, '#file-idle'), '切回文件标签后不是文件面板');
    assertRoomIntact(sender, code, '切标签后');
    step('两个标签来回切，房间和码都在');

    /* ---- 5. 房间里选文件 → 对方看到确认框 → 拒绝 ---- */
    await pickFiles(sender, [{ name: 'room-a.bin', size: 1_500_000, seed: 4 }]);
    await receiver.waitForSelector('#file-ask:not([hidden])', { timeout: 30000 });
    assert.equal(await receiver.locator('#ask-name').textContent(), 'room-a.bin');
    assertRoomIntact(receiver, code, '收到确认框后');
    step('房间里选文件，对方看到确认框');

    await receiver.click('#decline');
    await receiver.waitForSelector('#file-idle:not([hidden])', { timeout: 10000 });
    assertRoomIntact(receiver, code, '拒绝后');
    await sender.waitForFunction(
      () => document.getElementById('room-status').textContent.includes('拒绝'),
      null,
      { timeout: 20000 },
    );
    assertRoomIntact(sender, code, '收到拒绝后');
    assert.ok(await visible(sender, '#file-idle'), '被拒绝后房主应该回到文件面板');
    step('拒绝：两边都留在原房间');

    /* ---- 6. 同一房间换一批文件，接收方接受 ---- */
    await pickFiles(sender, [{ name: 'room-b.bin', size: 2_200_000, seed: 5 }]);
    await receiver.waitForSelector('#file-ask:not([hidden])', { timeout: 30000 });
    assert.equal(await receiver.locator('#ask-name').textContent(), 'room-b.bin');
    await receiver.click('#accept');
    await receiver.waitForFunction(() => window.__blobs.length >= 1, null, { timeout: 120000 });

    const first = await blobAt(receiver, 0);
    assert.equal(first.size, 2_200_000, '第一个文件大小不对');
    assert.equal(first.hash, createHash('sha256').update(fillBytes(2_200_000, 5)).digest('hex'), '第一个文件哈希不对');
    await sender.waitForFunction(
      () => document.getElementById('xfer-sub').textContent.includes('完成'),
      null,
      { timeout: 30000 },
    );
    step('第二批文件传完，哈希一致');

    /* ---- 7. 传完点「返回」：回到房间而不是回大厅 ---- */
    await sender.click('#back');
    await sender.waitForSelector('#file-idle:not([hidden])', { timeout: 10000 });
    assertRoomIntact(sender, code, '传完点返回后');
    step('返回按钮回到房间，码没变');

    /* ---- 8. 第三批：验证发送锁真的放开了 ---- */
    await pickFiles(sender, [{ name: 'room-c.bin', size: 900_000, seed: 6 }]);
    await receiver.waitForSelector('#file-ask:not([hidden])', { timeout: 30000 });
    await receiver.click('#accept');
    await receiver.waitForFunction(() => window.__blobs.length >= 2, null, { timeout: 60000 });
    const second = await blobAt(receiver, 1);
    assert.equal(second.size, 900_000, '第三批大小不对');
    assert.equal(second.hash, createHash('sha256').update(fillBytes(900_000, 6)).digest('hex'), '第三批哈希不对');
    step('同一房间第三批也发得出去（发送锁已释放）');

    /* ---- 9. 收文件的时候能切到「消息」，对方的消息也不会丢 ---- */
    await pickFiles(sender, [{ name: 'room-d.bin', size: 64 * 1024 * 1024, seed: 7 }]);
    await receiver.waitForSelector('#file-ask:not([hidden])', { timeout: 30000 });
    await receiver.click('#accept');
    await receiver.waitForSelector('#file-progress:not([hidden])', { timeout: 10000 });

    // 接收方还在文件面板上收，发送方切到文本发一句
    await sender.click('#tab-text');
    await sender.fill('#chat-input', '边传边聊试试');
    await sender.press('#chat-input', 'Enter');

    // 接收方不被打断，只在「消息」上出现未读点
    await receiver.waitForFunction(
      () => !document.getElementById('chat-badge').hidden,
      null,
      { timeout: 15000 },
    );
    assert.ok(await visible(receiver, '#file-progress'), '收到消息不该打断接收中的画面');
    assert.equal(await visible(receiver, '#panel-text'), false, '收到消息不该自动切走');
    step('接收中收到消息：只亮未读点，不抢画面');

    // 切过去就能看到消息，未读点消失
    await receiver.click('#tab-text');
    await receiver.waitForFunction(
      () => [...document.querySelectorAll('#chat-list li')].some((li) => li.textContent.includes('边传边聊试试')),
      null,
      { timeout: 15000 },
    );
    assert.equal(await receiver.evaluate(() => document.getElementById('chat-badge').hidden), true, '未读点没清掉');
    step('切到文本就能看到消息，接收还在继续');

    await receiver.waitForFunction(() => window.__blobs.length >= 3, null, { timeout: 120000 });
    const fourth = await blobAt(receiver, 2);
    assert.equal(fourth.size, 64 * 1024 * 1024, '第四批大小不对');
    assert.equal(
      fourth.hash,
      createHash('sha256').update(fillBytes(64 * 1024 * 1024, 7)).digest('hex'),
      '第四批哈希不对',
    );
    step('切标签不影响接收，文件完整');

    /* ---- 10. 闲在文件面板时收到消息：只亮未读灯，不抢画面 ---- */
    await receiver.click('#tab-file');
    await receiver.click('#back'); // 回到文件面板的空闲态
    await receiver.waitForSelector('#file-idle:not([hidden])', { timeout: 10000 });

    await sender.click('#tab-text');
    await sender.fill('#chat-input', '房间里发的消息');
    await sender.press('#chat-input', 'Enter');

    await receiver.waitForFunction(
      () => !document.getElementById('chat-badge').hidden,
      null,
      { timeout: 15000 },
    );
    assert.equal(await visible(receiver, '#panel-text'), false, '收到消息不该自动切走');
    assert.ok(await visible(receiver, '#file-idle'), '收到消息时文件面板应该还在');
    assertRoomIntact(receiver, code, '闲时收到消息后');
    step('闲时收到消息：只亮未读灯，不抢画面');

    await receiver.click('#tab-text');
    await receiver.waitForFunction(
      () => [...document.querySelectorAll('#chat-list li')].some((li) => li.textContent.includes('房间里发的消息')),
      null,
      { timeout: 15000 },
    );
    assert.equal(
      await receiver.evaluate(() => document.getElementById('chat-badge').hidden),
      true,
      '看了消息之后未读灯还亮着',
    );
    assertRoomIntact(receiver, code, '收到文本后');

    await receiver.fill('#chat-input', '房间还在，回你一句');
    await receiver.press('#chat-input', 'Enter');
    await sender.waitForFunction(
      () => [...document.querySelectorAll('#chat-list li')].some((li) => li.textContent.includes('回你一句')),
      null,
      { timeout: 15000 },
    );
    assertRoomIntact(sender, code, '互发文本后');
    step('同一个房间里互发文本，码没变');

    // 从文本面板切回文件面板：房间还在，文件面板保留上次状态
    await receiver.click('#tab-file');
    assert.ok(await visible(receiver, '#panel-file'), '切回文件标签后文件面板没出来');
    assertRoomIntact(receiver, code, '文本切回文件后');
    step('聊完还能切回文件面板');

    /* ---- 11. 离开：回大厅，并拿到自己的新码 ---- */
    await sender.click('#leave');
    await sender.waitForSelector('#view-lobby:not([hidden])', { timeout: 10000 });
    assert.equal(await sender.locator('#view-room').isVisible(), false, '离开后房间还显示着');
    const fresh = await waitLobbyCode(sender);
    assert.notEqual(fresh, code, '离开后大厅里的码没换');
    step(`离开回到大厅，新码 ${fresh}`);

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
