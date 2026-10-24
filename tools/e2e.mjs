/**
 * 真实浏览器里的端到端传输测试：
 * 两个独立 context 当发送方和接收方，走完整链路（建房 → 信令 → WebRTC → 分块 → 落盘 → 校验）。
 *
 * 用法：
 *   node tools/e2e.mjs                       # 默认传 3 个文件
 *   SIZE_MB=64 node tools/e2e.mjs            # 单个大文件，测吞吐
 *   BASE_URL=http://127.0.0.1:8787 node tools/e2e.mjs   # 打线上环境
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
const CHUNK_KB = process.env.CHUNK_KB || '';

// 不指定 SIZE_MB 就跑多文件，覆盖「大 / 中 / 小」三种尺寸
const SINGLE = Number(process.env.SIZE_MB || 0) * 1024 * 1024;
const FILES = SINGLE
  ? [{ name: 'single.bin', size: SINGLE, seed: 0 }]
  : [
      { name: 'alpha.bin', size: 3 * 1024 * 1024, seed: 1 },
      { name: 'beta.bin', size: 1024 * 1024, seed: 2 },
      { name: 'gamma.bin', size: 384 * 1024, seed: 3 },
    ];

const totalBytes = FILES.reduce((n, f) => n + f.size, 0);

const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const fill = (size, seed) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7 + seed * 13) & 255;
  return bytes;
};

const expected = FILES.map((f) => createHash('sha256').update(fill(f.size, f.seed)).digest('hex'));

const step = (msg) => console.log(`  · ${msg}`);

/* ---------------- 起服务 ---------------- */

let server = null;

async function ensureServer() {
  if (process.env.BASE_URL) return process.env.BASE_URL;

  const url = 'http://127.0.0.1:8787';
  try {
    await fetch(url, { signal: AbortSignal.timeout(800) });
    return url;
  } catch {
    /* 没起，自己拉一个 */
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
      if (res.ok) {
        step('dev-server 已启动');
        return url;
      }
    } catch {
      /* 还没起来 */
    }
  }
  throw new Error('dev-server 启动超时');
}

/* ---------------- 浏览器 ---------------- */

let browser = null;

async function main() {
  const base = await ensureServer();
  browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });

  const senderCtx = await browser.newContext();
  const receiverCtx = await browser.newContext();
  const sender = await senderCtx.newPage();
  const receiver = await receiverCtx.newPage();

  const errors = [];
  for (const [name, page] of [
    ['sender', sender],
    ['receiver', receiver],
  ]) {
    page.on('pageerror', (err) => errors.push(`${name} pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`${name} console: ${msg.text()}`);
    });
  }

  try {
    // 接收端强制走内存 Blob 分支：文件/目录选择框会弹原生窗口，headless 点不了
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

    const target = CHUNK_KB ? `${base}/?chunk=${CHUNK_KB}` : base;
    await sender.goto(target);
    await receiver.goto(target);
    step('两个页面已打开');

    // 大厅只显示取件码；对方输码进来之后两边才进房间，文件在房间里选
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
    assert.equal((await sender.locator('#room-code').textContent()).trim(), code, '房间里的码变了');
    step('双方都进入房间');

    await sender.evaluate((files) => {
      const dt = new DataTransfer();
      for (const f of files) {
        const bytes = new Uint8Array(f.size);
        for (let i = 0; i < f.size; i += 1) bytes[i] = (i * 31 + 7 + f.seed * 13) & 255;
        dt.items.add(new File([bytes], f.name, { type: 'application/octet-stream' }));
      }
      const input = document.getElementById('file-wait');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, FILES);

    await receiver.waitForSelector('#file-ask:not([hidden])', { timeout: 30000 });

    assert.equal(await receiver.locator('#ask-name').textContent(), FILES[0].name);
    if (FILES.length > 1) {
      assert.match(
        await receiver.locator('#ask-size').textContent(),
        new RegExp(`共 ${FILES.length} 个文件`),
      );
    }
    step(`接收端收到清单（${FILES.length} 个文件，共 ${(totalBytes / 1024 / 1024).toFixed(1)} MB）`);

    const startedAt = Date.now();
    await receiver.click('#accept');
    await receiver.waitForFunction(
      (n) => window.__blobs.length >= n,
      FILES.length,
      { timeout: 120000 },
    );
    const seconds = (Date.now() - startedAt) / 1000;
    step(`接收完成 · ${seconds.toFixed(2)}s · ${(totalBytes / 1024 / 1024 / seconds).toFixed(1)} MB/s`);

    const got = await receiver.evaluate(async () => {
      const out = [];
      for (const blob of window.__blobs) {
        const buf = await blob.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', buf);
        out.push({
          size: blob.size,
          hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
        });
      }
      return out;
    });

    assert.equal(got.length, FILES.length, `应收到 ${FILES.length} 个文件，实际 ${got.length}`);
    got.forEach((file, i) => {
      assert.equal(file.size, FILES[i].size, `第 ${i + 1} 个文件大小不对`);
      assert.equal(file.hash, expected[i], `第 ${i + 1} 个文件哈希不对`);
    });
    step(`逐文件校验通过 · ${got.length}/${FILES.length}`);

    assert.match(await sender.locator('#xfer-sub').textContent(), /完成/);

    // 接收端的每一行都要收尾：类名 done、状态「已完成」、进度条 100%
    const rows = await receiver.evaluate(() =>
      [...document.querySelectorAll('#file-list li')].map((li) => ({
        done: li.classList.contains('done'),
        state: li.querySelector('.fl-state')?.textContent?.trim() || '',
        width: li.querySelector('.fl-bar i')?.style.width || '',
      })),
    );
    assert.ok(rows.length >= FILES.length, `接收端文件行数不对: ${rows.length}`);
    for (const [i, row] of rows.entries()) {
      assert.ok(row.done, `第 ${i + 1} 行没有 done 类`);
      assert.equal(row.state, '已完成', `第 ${i + 1} 行状态是「${row.state}」`);
      assert.equal(Number.parseFloat(row.width), 100, `第 ${i + 1} 行进度条是 ${row.width}`);
    }
    step(`接收端 ${rows.length} 行全部收尾（已完成 + 满格）`);
    assert.ok(
      await receiver.evaluate(() => document.querySelector('.bar')?.classList.contains('done')),
      '主进度条没有收尾（.bar 缺 done 类）',
    );

    const v1 = (await sender.locator('#verify-code').textContent()).trim();
    const v2 = (await receiver.locator('#verify-code').textContent()).trim();
    assert.ok(v1.length >= 8, `发送端校验码异常: ${v1}`);
    assert.equal(v1, v2, '两端校验码不一致');
    step(`两端校验码一致 ${v1}`);

    const path = (await receiver.locator('#path').textContent()).trim();
    step(`链路 ${path || '(未知)'} · 分块 ${CHUNK_KB || '默认'} KB`);

    console.log('\n端到端传输通过');
  } catch (err) {
    console.error('\n端到端测试失败:', err.message);
    if (errors.length) console.error('页面报错:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (err) {
  console.error('\n启动失败:', err.message);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server?.kill();
}
