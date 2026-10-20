import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const jsIds = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));

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

await test('app.js 引用的 DOM id 都存在于 index.html', async () => {
  const missing = [...jsIds].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, [], `缺少这些 id: ${missing.join(', ')}`);
});

await test('每个 view-* 都有对应的 show() 调用', async () => {
  const views = [...htmlIds].filter((id) => id.startsWith('view-')).map((id) => id.slice(5));
  const shown = new Set([...js.matchAll(/show\('([^']+)'\)/g)].map((m) => m[1]));
  const unreachable = views.filter((name) => !shown.has(name));
  assert.deepEqual(unreachable, [], `这些视图永远不会被显示: ${unreachable.join(', ')}`);
});

await test('show() 的目标都有对应 section', async () => {
  const shown = new Set([...js.matchAll(/show\('([^']+)'\)/g)].map((m) => m[1]));
  const views = new Set(
    [...htmlIds].filter((id) => id.startsWith('view-')).map((id) => id.slice(5)),
  );
  const dangling = [...shown].filter((name) => !views.has(name));
  assert.deepEqual(dangling, [], `show() 了不存在的视图: ${dangling.join(', ')}`);
});

await test('HTML 里没有残留的占位路径', async () => {
  assert.ok(!html.includes('REPLACE_ME'));
});

console.log(lines.join('\n'));
console.log(process.exitCode ? '\n有失败用例' : '\n全部通过');
