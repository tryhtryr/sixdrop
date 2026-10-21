/**
 * 扫参：不同「发送水位 / 低水位阈值」下的 1 GB 传输速度。
 *   node tools/sweep.mjs
 * 需要 PVE 上已经放好 /opt/pve-receive.py。
 */
import { spawn } from 'node:child_process';

const MB = Number(process.env.SWEEP_MB || 1000);
const CONFIGS = (process.env.SWEEP_CONFIGS || '8/4,12/8,12/10,16/12')
  .split(',')
  .map((s) => s.split('/').map(Number));

const run = (cmd, args, env, onLine) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, shell: false });
    let out = '';
    p.stdout.on('data', (d) => {
      const s = d.toString();
      out += s;
      onLine?.(s);
    });
    p.stderr.on('data', (d) => {
      out += d.toString();
    });
    p.on('close', () => resolve(out));
  });

for (const [water, low] of CONFIGS) {
  console.log(`\n=== water=${water}MB low=${low}MB ===`);
  let code = '';

  const senderPromise = run(
    process.execPath,
    ['tools/measure-send.mjs', String(MB)],
    { SEND_URL: `https://sixdrop.dev/?water=${water}&low=${low}` },
    (s) => {
      const m = s.match(/取件码\s+([2-9A-HJ-NP-Z]{6})/);
      if (m) code = m[1];
    },
  );

  // 等取件码出现
  for (let i = 0; i < 100 && !code; i += 1) await new Promise((r) => setTimeout(r, 200));
  if (!code) {
    console.log('  没拿到取件码，跳过');
    continue;
  }

  const recvOut = await run('ssh', ['-o', 'BatchMode=yes', 'pve', `timeout 400 python3 /opt/pve-receive.py ${code}`], {});
  const senderOut = await senderPromise;

  let recv = null;
  try {
    recv = JSON.parse(/RESULT (\{.*\})/.exec(recvOut)[1]);
  } catch {
    /* 忽略 */
  }
  const sendAvg = /平均速度 · ([\d.]+) MB\/s/.exec(senderOut)?.[1];
  const sendSecs = /发送完成 · ([\d.]+) 秒/.exec(senderOut)?.[1];

  if (recv && recv.seconds) {
    console.log(
      `  接收端 ${recv.seconds.toFixed(2)}s · ${(MB / recv.seconds).toFixed(1)} MB/s · 稳态 ${recv.last}`,
    );
  } else {
    console.log('  接收端：', recvOut.trim().slice(-200));
  }
  console.log(`  发送端 ${sendSecs || '?'}s · ${sendAvg || '?'} MB/s`);
}
