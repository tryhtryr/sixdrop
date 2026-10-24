/**
 * 在真实浏览器里验证中转链路（重点看 CORS 和 ETag 暴露）。
 * 页面本身跑在 http://127.0.0.1:8787，PUT 直接打到 R2 的 S3 端点。
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

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
const page = await browser.newPage();

try {
  await page.goto(BASE);

  const out = await page.evaluate(async (size) => {
    const sign = await fetch('/api/relay/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'browser-probe.bin', size }),
    }).then((r) => r.json());

    if (!sign.url) return { error: `sign 失败: ${JSON.stringify(sign)}` };

    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) bytes[i] = (i * 17 + 3) & 255;

    const etag = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', sign.url);
      xhr.upload.onprogress = () => {};
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.getResponseHeader('ETag'));
        else reject(new Error(`PUT ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('PUT 被 CORS 或网络拦住了'));
      xhr.send(bytes);
    });

    const link = await fetch(`/api/relay/link?key=${encodeURIComponent(sign.key)}`).then((r) => r.json());
    const res = await fetch(link.url);
    const back = await res.arrayBuffer();

    return { etag, size: back.byteLength, status: res.status };
  }, 1024 * 1024);

  assert.ok(!out.error, out.error);
  assert.equal(out.status, 200, '下载状态异常');
  assert.equal(out.size, 1024 * 1024, '下载字节数不一致');
  assert.ok(out.etag, '浏览器读不到 ETag —— CORS 的 ExposeHeaders 没生效');

  console.log(`  · 浏览器 PUT 成功，ETag=${out.etag.slice(0, 8)}…`);
  console.log(`  · 浏览器 GET 成功，${out.size} B`);
  console.log('\n浏览器中转链路通过');
} catch (err) {
  console.error('\n浏览器中转链路失败:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
