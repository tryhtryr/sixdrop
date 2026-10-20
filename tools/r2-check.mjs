/**
 * 用真实 R2 验证中转链路：签名 → 上传 → 下发链接 → 下载 → 比对哈希。
 *
 *   node tools/r2-check.mjs
 *   BASE_URL=http://127.0.0.1:8787 node tools/r2-check.mjs
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

const BASE = process.env.BASE_URL || 'https://sixdrop.dev';
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
};

const put = async (url, buf) => {
  const res = await fetch(url, { method: 'PUT', body: buf });
  if (!res.ok) throw new Error(`PUT → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.headers.get('etag') || '';
};

const download = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

const step = (msg) => console.log(`  · ${msg}`);

/* ---------- 1. 单次 PUT ---------- */

{
  const payload = randomBytes(2 * 1024 * 1024);
  const sign = await post('/api/relay/sign', { name: 'probe-single.bin', size: payload.length });
  assert.equal(sign.mode, 'put');
  step(`单次 PUT 签名完成 key=${sign.key.slice(0, 24)}…`);

  await put(sign.url, payload);
  const link = await fetch(`${BASE}/api/relay/link?key=${encodeURIComponent(sign.key)}`).then((r) => r.json());
  assert.ok(link.url, '没拿到下载链接');

  const back = await download(link.url);
  assert.equal(back.length, payload.length, '字节数不一致');
  assert.equal(sha(back), sha(payload), 'SHA-256 不一致');
  step(`单次上传下载校验通过 · ${payload.length} B`);
}

/* ---------- 2. 分片上传 ---------- */

{
  // 声明一个刚超过单次上限的大小，走到 multipart 分支
  const declared = 5 * 1024 ** 3 + 1024 ** 2;
  const sign = await post('/api/relay/sign', { name: 'probe-multi.bin', size: declared });
  assert.equal(sign.mode, 'multipart');
  assert.ok(sign.urls.length >= 2, `分片数异常: ${sign.urls.length}`);
  step(`分片签名完成 · ${sign.urls.length} 片 × ${(sign.partSize / 1024 ** 2).toFixed(0)} MiB`);

  // 只实际上传前两片（第一片 > 5 MiB），用来验证合并流程
  const p1 = randomBytes(6 * 1024 * 1024);
  const p2 = randomBytes(1024 * 1024);

  const e1 = await put(sign.urls[0], p1);
  const e2 = await put(sign.urls[1], p2);
  assert.ok(e1 && e2, '没拿到 ETag（CORS/暴露头问题）');
  step(`两片上传完成，ETag 已拿到`);

  const done = await post('/api/relay/complete', {
    key: sign.key,
    uploadId: sign.uploadId,
    parts: [
      { partNumber: 1, etag: e1 },
      { partNumber: 2, etag: e2 },
    ],
  });
  assert.ok(done.url, '合并后没拿到链接');

  const back = await download(done.url);
  const expected = Buffer.concat([p1, p2]);
  assert.equal(back.length, expected.length, '合并后大小不一致');
  assert.equal(sha(back), sha(expected), '合并后 SHA-256 不一致');
  step(`分片合并校验通过 · ${back.length} B`);
}

/* ---------- 3. 分享页（对方关掉页面也能回来拿） ---------- */

{
  const payload = randomBytes(256 * 1024);
  const sign = await post('/api/relay/sign', { name: 'share-probe.bin', size: payload.length });
  await put(sign.url, payload);

  const created = await post('/api/drop', {
    files: [{ name: 'share-probe.bin', size: payload.length, key: sign.key }],
  });
  assert.ok(created.token && created.url, '没拿到分享链接');
  step(`分享页已创建 ${created.url}`);

  const page = await fetch(created.url);
  assert.equal(page.status, 200, '分享页打不开');
  assert.equal(new URL(page.url).pathname, `/d/${created.token}`, '分享页被重定向，路径丢了');
  assert.ok((await page.text()).includes('SixDrop'), '分享页内容不对');

  const list = await fetch(`${BASE}/api/drop/${created.token}`).then((r) => r.json());
  assert.equal(list.files.length, 1, '清单里没有文件');

  const back = await download(list.files[0].url);
  assert.equal(sha(back), sha(payload), '分享页下载的哈希不一致');
  step(`分享页取回校验通过 · ${back.length} B`);

  // 收完立刻删：对象和清单都该没了
  const del = await post('/api/drop/delete', { token: created.token });
  assert.equal(del.deleted, 1, '删除数量不对');

  const gone = await fetch(`${BASE}/api/drop/${created.token}`);
  assert.equal(gone.status, 404, '分享页应该已经失效');

  const fileGone = await fetch(list.files[0].url);
  assert.equal(fileGone.status, 404, 'R2 里的对象应该已经删除');
  step('接收后立即删除：对象与分享页都已清空');
}

console.log('\nR2 中转链路通过');
