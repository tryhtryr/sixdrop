import assert from 'node:assert/strict';
import { handleRelay } from '../src/relay.js';

const endpoint = (p) => new URL(`https://example.test${p}`);

const CFG = {
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_BUCKET: 'sixdrop-files',
  R2_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  R2_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

const lines = [];
async function test(name, fn) {
  try {
    await fn();
    lines.push(`  ok   ${name}`);
  } catch (err) {
    lines.push(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

const call = async (path, env, method = 'GET', body = {}) => {
  const res = await handleRelay({ method, json: async () => body }, env, endpoint(path));
  return { status: res.status, data: await res.json() };
};

await test('未配置时 status 报 enabled:false', async () => {
  const { status, data } = await call('/api/relay/status', {});
  assert.equal(status, 200);
  assert.equal(data.enabled, false);
});

await test('未配置时 sign 返回 503', async () => {
  const { status } = await call('/api/relay/sign', {}, 'POST', { name: 'a', size: 1 });
  assert.equal(status, 503);
});

await test('配置后返回预签名 PUT 链接', async () => {
  const { status, data } = await call('/api/relay/sign', CFG, 'POST', {
    name: 'ubuntu.iso',
    size: 1024,
  });

  assert.equal(status, 200);
  assert.equal(data.mode, 'put');
  assert.match(data.url, /^https:\/\/0123456789abcdef0123456789abcdef\.r2\.cloudflarestorage\.com\/sixdrop-files\/r\//);
  assert.match(data.url, /X-Amz-Signature=/);
  assert.match(data.url, /X-Amz-Credential=/);
  assert.match(data.url, /X-Amz-Expires=\d+/);
  assert.ok(data.key.endsWith('/ubuntu.iso'));
});

await test('文件名里的路径穿越被清洗掉', async () => {
  const { status, data } = await call('/api/relay/sign', CFG, 'POST', {
    name: '../../etc/passwd',
    size: 1024,
  });

  assert.equal(status, 200);
  assert.ok(!data.key.includes('..'), `key 里不该出现 ..: ${data.key}`);
  assert.equal(data.key.split('/').length, 3, '只允许 r/<uuid>/<name> 三段');
});

await test('超过 5 TiB 直接拒绝', async () => {
  const { status } = await call('/api/relay/sign', CFG, 'POST', {
    name: 'huge',
    size: 6 * 1024 ** 4,
  });
  assert.equal(status, 413);
});

await test('大小为 0 或非法时拒绝', async () => {
  assert.equal((await call('/api/relay/sign', CFG, 'POST', { name: 'x', size: 0 })).status, 400);
  assert.equal((await call('/api/relay/sign', CFG, 'POST', { name: 'x', size: 'abc' })).status, 400);
});

await test('link 接口只接受 r/ 开头的 key', async () => {
  const bad = await call('/api/relay/link?key=somebody-else/key', CFG);
  assert.equal(bad.status, 400);

  const good = await call('/api/relay/link?key=r/abc/file.bin', CFG);
  assert.equal(good.status, 200);
  assert.match(good.data.url, /X-Amz-Signature=/);
});

console.log(lines.join('\n'));
console.log(process.exitCode ? '\n有失败用例' : '\n全部通过');
