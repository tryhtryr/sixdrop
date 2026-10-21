/**
 * 对照实验：同一个浏览器，用最普通的 HTTP 下载 256 MB，
 * 看它是多少 MB/s。用来判断「15 MB/s」到底是我们的代码，还是这台机器的浏览器环境。
 *   node tools/bench-http.mjs
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const MB = Number(process.env.BENCH_MB || 256);
const CHUNK = 1024 * 1024;
const chunkBuf = Buffer.alloc(CHUNK, 7);

const server = createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>bench</title><body>bench');
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': String(MB * CHUNK),
    'cache-control': 'no-store',
  });
  let sent = 0;
  const pump = () => {
    while (sent < MB) {
      const ok = res.write(chunkBuf);
      sent += 1;
      if (!ok) {
        res.once('drain', pump);
        return;
      }
    }
    res.end();
  };
  pump();
});

await new Promise((r) => server.listen(8899, '127.0.0.1', r));

const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:8899/');

const result = await page.evaluate(async (mb) => {
  const started = performance.now();
  const res = await fetch('/blob');
  const reader = res.body.getReader();
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
  }
  const seconds = (performance.now() - started) / 1000;
  return { mb: bytes / 1024 / 1024, seconds, mbps: bytes / 1024 / 1024 / seconds };
}, MB);

console.log(`  普通 HTTP 下载: ${result.mb.toFixed(0)} MB · ${result.seconds.toFixed(2)} s · ${result.mbps.toFixed(1)} MB/s`);

await browser.close();
server.close();
