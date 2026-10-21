/**
 * 多通道并行基准：同一个 SCTP 关联里开 N 条 DataChannel，看总吞吐能不能叠加。
 *   node tools/bench-multi.mjs
 * 环境变量：BENCH_MB（总量，默认 256）、BENCH_CHANNELS（逗号分隔，默认 1,2,4,8）
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const MB = Number(process.env.BENCH_MB || 256);
const LIST = (process.env.BENCH_CHANNELS || '1,2,4,8').split(',').map(Number);
const CHUNK = 256 * 1024;
const ORDERED = process.env.BENCH_UNORDERED !== '1';

const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
const page = await browser.newPage();

const run = (n) =>
  page.evaluate(
    async ({ n, MB, CHUNK, ORDERED }) => {
      const a = new RTCPeerConnection();
      const b = new RTCPeerConnection();
      a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
      b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);

      const total = MB * 1024 * 1024;
      const per = Math.floor(total / n);
      let received = 0;
      let finished = 0;
      let resolveAll;
      const allDone = new Promise((r) => (resolveAll = r));

      b.ondatachannel = (e) => {
        const rd = e.channel;
        rd.binaryType = 'arraybuffer';
        rd.onmessage = (ev) => {
          if (typeof ev.data === 'string') {
            finished += 1;
            if (finished === n) resolveAll();
            return;
          }
          received += ev.data.byteLength;
        };
      };

      const chans = [];
      for (let i = 0; i < n; i += 1) {
        const dc = a.createDataChannel(`ch${i}`, { ordered: ORDERED });
        dc.binaryType = 'arraybuffer';
        chans.push(dc);
      }

      const offer = await a.createOffer();
      await a.setLocalDescription(offer);
      await b.setRemoteDescription(offer);
      const answer = await b.createAnswer();
      await b.setLocalDescription(answer);
      await a.setRemoteDescription(answer);

      await Promise.all(
        chans.map(
          (dc) =>
            new Promise((r) => {
              dc.bufferedAmountLowThreshold = 4 * 1024 * 1024;
              if (dc.readyState === 'open') r();
              else dc.onopen = r;
            }),
        ),
      );

      const started = performance.now();
      const buf = new Uint8Array(CHUNK);

      await Promise.all(
        chans.map(async (dc) => {
          let sent = 0;
          while (sent < per) {
            if (dc.bufferedAmount > 8 * 1024 * 1024) {
              await new Promise((r) => {
                const h = () => {
                  dc.removeEventListener('bufferedamountlow', h);
                  r();
                };
                dc.addEventListener('bufferedamountlow', h);
                setTimeout(() => {
                  dc.removeEventListener('bufferedamountlow', h);
                  r();
                }, 300);
              });
            }
            for (let k = 0; k < 8 && sent < per; k += 1) {
              try {
                dc.send(buf);
                sent += CHUNK;
              } catch {
                await new Promise((r) => setTimeout(r, 30));
              }
            }
          }
          dc.send('end');
        }),
      );

      await allDone;
      const seconds = (performance.now() - started) / 1000;
      a.close();
      b.close();
      return { mb: received / 1024 / 1024, seconds, mbps: received / 1024 / 1024 / seconds };
    },
    { n, MB, CHUNK, ORDERED },
  );

console.log(`  总量 ${MB} MB / 每块 ${CHUNK / 1024} KB / ordered=${ORDERED}`);
for (const n of LIST) {
  const r = await run(n);
  console.log(`  ${String(n).padStart(2)} 条通道 → ${r.mbps.toFixed(1)} MB/s  (${r.secs ? '' : ''}${r.seconds.toFixed(2)}s)`);
}

await browser.close();
