/**
 * 同网发现验收：发现 → 申请 → 房主同意 → 进房间 → 传文件；以及拒绝、可见开关。
 *
 *   node tools/discover-e2e.mjs
 *   BASE_URL=http://127.0.0.1:8787 node tools/discover-e2e.mjs
 *
 * 说明：分组键是出口 IP（本地 dev-server 拿不到 CF-Connecting-IP，统一按 dev 分组），
 * 所以两个 context 在同一个进程里天然「同网」，线上跑也用同一台机器的公网 IP。
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

// 每次跑用不同的设备名：同网大厅里可能还有上一轮残留的条目（3 分钟过期）
const TAG = Math.random().toString(36).slice(2, 6).toUpperCase();
const A_LABEL = `E2E-甲机-${TAG}`;
const B_LABEL = `E2E-乙机-${TAG}`;
const FILE = { name: 'discover.bin', size: 1_200_000, seed: 11 };

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

/* ---------------- 小工具 ---------------- */

const lobbyCode = async (page) => (await page.locator('#lobby-code').textContent()).trim();

async function waitLobbyCode(page) {
  await page.waitForFunction(
    () => /^[2-9A-HJ-NP-Z]{6}$/.test(document.getElementById('lobby-code').textContent.trim()),
    null,
    { timeout: 30000 },
  );
  return lobbyCode(page);
}

/** 列表里出现某个设备名 */
function waitDevice(page, label, timeout = 25000) {
  return page.waitForFunction(
    (text) => [...document.querySelectorAll('#lobby-list .dev b')].some((el) => el.textContent === text),
    label,
    { timeout },
  );
}

function deviceGone(page, label, timeout = 15000) {
  return page.waitForFunction(
    (text) => ![...document.querySelectorAll('#lobby-list .dev b')].some((el) => el.textContent === text),
    label,
    { timeout },
  );
}

async function applyTo(page, label) {
  await page.locator('#lobby-list li', { hasText: label }).locator('button').click();
  try {
    await page.waitForSelector('#view-room:not([hidden])', { timeout: 20000 });
  } catch (err) {
    const state = await page.evaluate(() => ({
      url: location.href,
      lobby: !document.getElementById('view-lobby').hidden,
      toast: document.getElementById('toast').textContent,
      hint: document.getElementById('lobby-hint').textContent,
    }));
    throw new Error(`点「${label}」后没进房间：${JSON.stringify(state)}`);
  }
}

async function main() {
  const base = await ensureServer();
  const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
  const errors = [];

  try {
    const aCtx = await browser.newContext();
    const bCtx = await browser.newContext();
    const a = await aCtx.newPage();
    const b = await bCtx.newPage();

    for (const [name, page] of [
      ['A', a],
      ['B', b],
    ]) {
      page.on('pageerror', (err) => errors.push(`${name} pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`${name} console: ${msg.text()}`);
      });
    }

    // 固定的设备名，方便在列表里认出对方（也顺便验证设备名是从前端带上去的）
    await a.addInitScript((label) => {
      try {
        localStorage.setItem('sixdrop.name', label);
      } catch {
        /* 忽略 */
      }
    }, A_LABEL);
    await b.addInitScript((label) => {
      try {
        localStorage.setItem('sixdrop.name', label);
      } catch {
        /* 忽略 */
      }
    }, B_LABEL);
    await b.addInitScript(() => {
      window.showSaveFilePicker = undefined;
      window.showDirectoryPicker = undefined;
      window.__blobs = [];
      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        window.__blobs.push(blob);
        return original(blob);
      };
    });

    /* ---- 1. 两台都在大厅，互相发现 ---- */
    await a.goto(base);
    await b.goto(base);

    const codeA = await waitLobbyCode(a);
    const codeB = await waitLobbyCode(b);
    assert.match(codeA, CODE_RE);
    assert.match(codeB, CODE_RE);
    assert.notEqual(codeA, codeB, '两台应该各拿一个码');

    await waitDevice(b, A_LABEL);
    await waitDevice(a, B_LABEL);

    const tile = await b.evaluate((label) => {
      const el = [...document.querySelectorAll('#lobby-list li')].find(
        (x) => x.querySelector('.dev b').textContent === label,
      );
      return el
        ? {
            age: el.querySelector('.age').textContent,
            platform: el.querySelector('.dev .sub')?.textContent || '',
            icon: Boolean(el.querySelector('.icon svg')),
          }
        : null;
    }, A_LABEL);
    assert.ok(tile, '同网列表里应该有甲机');
    assert.ok(tile.icon, '列表行上应该有设备图标');
    assert.match(tile.platform, /Edge|Chrome|Safari|Firefox/, '副标题应该是浏览器/系统');
    step(`互相发现：乙机看到 ${A_LABEL}（${tile.age}）`);

    /* ---- 2. 申请 → 房主收到敲门，但还没进房间 ---- */
    await applyTo(b, A_LABEL);
    await b.waitForFunction(
      () => document.getElementById('room-status').textContent.includes('等待对方同意'),
      null,
      { timeout: 15000 },
    );
    assert.equal(await a.locator('#view-room').isVisible(), false, '还没同意，房主不该被拉进房间');

    await a.waitForSelector('#knock:not([hidden])', { timeout: 20000 });
    assert.equal(await a.locator('#knock-device').textContent(), B_LABEL);
    step('乙机申请，甲机看到审批条');

    /* ---- 3. 同意 → 两边进同一个房间 ---- */
    await a.click('#knock-admit');
    await a.waitForSelector('#view-room:not([hidden])', { timeout: 20000 });
    await b.waitForFunction(
      () => document.getElementById('room-status').textContent.includes('已直连'),
      null,
      { timeout: 30000 },
    );
    assert.equal((await a.locator('#room-code').textContent()).trim(), codeA);
    assert.equal((await b.locator('#room-code').textContent()).trim(), codeA, '乙机应该进入甲机的房间');
    step('房主同意，两边进同一个房间');

    /* ---- 4. 通道可用：传一个文件 ---- */
    await a.evaluate((file) => {
      const dt = new DataTransfer();
      const bytes = new Uint8Array(file.size);
      for (let i = 0; i < file.size; i += 1) bytes[i] = (i * 31 + 7 + file.seed * 13) & 255;
      dt.items.add(new File([bytes], file.name, { type: 'application/octet-stream' }));
      const input = document.getElementById('file-wait');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, FILE);

    await b.waitForSelector('#file-ask:not([hidden])', { timeout: 30000 });
    await b.click('#accept');
    await b.waitForFunction(() => window.__blobs.length >= 1, null, { timeout: 120000 });

    const got = await b.evaluate(async () => {
      const buf = await window.__blobs[0].arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return {
        size: buf.byteLength,
        hash: [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join(''),
      };
    });
    assert.equal(got.size, FILE.size);
    assert.equal(got.hash, createHash('sha256').update(fillBytes(FILE.size, FILE.seed)).digest('hex'));
    step('同网发现进来的连接能正常传文件（哈希一致）');

    /* ---- 5. 进了房间就不再被同网看到 ---- */
    await a.click('#leave');
    await a.waitForSelector('#view-lobby:not([hidden])', { timeout: 15000 });
    const aHome = await waitLobbyCode(a);
    assert.notEqual(aHome, codeA, '离开后应该换新码');

    await b.click('#leave');
    await b.waitForSelector('#view-lobby:not([hidden])', { timeout: 15000 });
    const bHome = await waitLobbyCode(b);
    assert.notEqual(bHome, codeA, '乙机离开后不该还挂着甲机的码');

    await waitDevice(b, A_LABEL);
    step('两边各自回大厅，房间从列表里消失、再重新出现');

    /* ---- 6. 拒绝：申请方回大厅，房主留在原地 ---- */
    await applyTo(b, A_LABEL);
    await a.waitForSelector('#knock:not([hidden])', { timeout: 20000 });
    assert.equal(await a.locator('#knock-device').textContent(), B_LABEL);
    await a.click('#knock-reject');

    await b.waitForSelector('#view-lobby:not([hidden])', { timeout: 20000 });
    const backHome = await waitLobbyCode(b);
    assert.notEqual(backHome, bHome, '被拒绝后应该重新开一个房间');
    assert.ok(await a.locator('#view-lobby').isVisible(), '拒绝后房主应该还在大厅');
    assert.equal(await a.locator('#knock').isVisible(), false, '审批条应该收起来');
    step('拒绝：申请方回大厅，房主留在原地');

    /* ---- 7. 可见开关：关掉就从别人列表里消失 ---- */
    await a.click('#discover-toggle');
    await a.waitForFunction(
      () => document.getElementById('discover-toggle').textContent.includes('关'),
      null,
      { timeout: 5000 },
    );
    assert.equal(
      await a.evaluate(() => document.getElementById('lobby-hint').textContent),
      '同一网络的人看不到这个房间',
    );
    await deviceGone(b, A_LABEL, 20000);
    step('关掉「同一网络可见」后，别人列表里立刻消失');

    await a.click('#discover-toggle');
    await waitDevice(b, A_LABEL, 20000);
    step('再打开又能被发现');

    if (errors.length) throw new Error('页面报错:\n' + errors.join('\n'));
    console.log('\n同网发现验收通过');
  } finally {
    await browser.close();
    server?.kill();
  }
}

try {
  await main();
} catch (err) {
  console.error('\n同网发现验收失败:', err.message);
  process.exitCode = 1;
}
