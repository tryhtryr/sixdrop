/**
 * 裸 DataChannel 吞吐基准：同一页面里建两个 PeerConnection 直连，
 * 只测 WebRTC 本身的能力，用来判断慢是我们代码的问题还是环境问题。
 *   node tools/bench-dc.mjs
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const MB = Number(process.env.BENCH_MB || 256);
const CHUNK = Number(process.env.BENCH_CHUNK_KB || 256) * 1024;

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
const page = await browser.newPage();

const result = await page.evaluate(
  async ({ MB, CHUNK }) => {
    const a = new RTCPeerConnection();
    const b = new RTCPeerConnection();
    a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
    b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);

    const dc = a.createDataChannel('bench', { ordered: true });
    dc.binaryType = 'arraybuffer';

    let received = 0;
    let done;
    const finished = new Promise((r) => (done = r));

    b.ondatachannel = (e) => {
      const rd = e.channel;
      rd.binaryType = 'arraybuffer';
      rd.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          if (ev.data === 'end') done();
          return;
        }
        received += ev.data.byteLength;
      };
    };

    const offer = await a.createOffer();
    await a.setLocalDescription(offer);
    await b.setRemoteDescription(offer);
    const answer = await b.createAnswer();
    await b.setLocalDescription(answer);
    await a.setRemoteDescription(answer);

    await new Promise((r) => {
      if (dc.readyState === 'open') return r();
      dc.onopen = r;
    });

    // 和水位实验一致：设低水位阈值，避免每次都等缓冲区彻底排空
    dc.bufferedAmountLowThreshold = Math.floor(4 * 1024 * 1024);

    const buf = new Uint8Array(CHUNK);
    const total = MB * 1024 * 1024;
    const started = performance.now();

    for (let sent = 0; sent < total; sent += CHUNK) {
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
          }, 500);
        });
      }
      dc.send(buf);
    }
    dc.send('end');
    await finished;
    const seconds = (performance.now() - started) / 1000;
    return { mb: received / 1024 / 1024, mbps: received / 1024 / 1024 / seconds };
  },
  { MB, CHUNK },
);

console.log(`  裸 DataChannel: ${result.mb.toFixed(0)} MB · ${result.mbps.toFixed(1)} MB/s`);
await browser.close();
