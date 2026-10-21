import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const jsIds = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));

// 合并后的房间：wait/ask/xfer/chat 不再是独立视图，而是 #view-room 里的面板
const panelBlock = /const PANEL_OF = \{([\s\S]*?)\n\};/.exec(js);
const panelKeys = panelBlock
  ? [...panelBlock[1].matchAll(/(\w+):\s*\[/g)].map((m) => m[1])
  : [];

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

await test('index.html 里没有重复 id', async () => {
  const all = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const dup = [...new Set(all.filter((v, i) => all.indexOf(v) !== i))];
  assert.deepEqual(dup, [], `重复 id: ${dup.join(', ')}`);
});

await test('每个 view-* 都有对应的 show() 调用', async () => {
  const views = [...htmlIds].filter((id) => id.startsWith('view-')).map((id) => id.slice(5));
  const shown = new Set([...js.matchAll(/show\('([^']+)'\)/g)].map((m) => m[1]));
  const unreachable = views.filter((name) => !shown.has(name));
  assert.deepEqual(unreachable, [], `这些视图永远不会被显示: ${unreachable.join(', ')}`);
});

await test('show() 的目标要么是视图，要么是房间面板', async () => {
  const shown = new Set([...js.matchAll(/show\('([^']+)'\)/g)].map((m) => m[1]));
  const views = new Set(
    [...htmlIds].filter((id) => id.startsWith('view-')).map((id) => id.slice(5)),
  );
  const dangling = [...shown].filter((name) => !views.has(name) && !panelKeys.includes(name));
  assert.deepEqual(dangling, [], `show() 了不存在的目标: ${dangling.join(', ')}`);
});

await test('房间面板路由覆盖 waiting / ask / xfer / chat 四态', async () => {
  assert.deepEqual(panelKeys.sort(), ['ask', 'chat', 'wait', 'xfer']);
  for (const id of ['panel-file', 'panel-text', 'file-idle', 'file-ask', 'file-progress']) {
    assert.ok(htmlIds.has(id), `缺少面板 ${id}`);
  }
});

await test('大厅只有取件码和输码加入，没有文件/标签', async () => {
  for (const id of ['view-lobby', 'lobby-code', 'code', 'join', 'copy', 'copy-link']) {
    assert.ok(htmlIds.has(id), `大厅缺少 ${id}`);
  }
  const lobby = /<section id="view-lobby"[\s\S]*?<\/section>/.exec(html);
  assert.ok(lobby, '找不到大厅 section');
  assert.ok(!/type="file"/.test(lobby[0]), '大厅不该有文件选择框');
  assert.ok(!/class="tab/.test(lobby[0]), '大厅不该有标签页');
  assert.ok(!/view-lobby[\s\S]*?drop/.test(lobby[0].replace(/<[^>]*>/g, ' ')), '大厅不该有拖放区');
});

await test('房间里有「收发文件 / 发送文本」两个标签', async () => {
  const room = /<section id="view-room"[\s\S]*?<\/section>/.exec(html);
  assert.ok(room, '找不到房间 section');
  for (const id of ['tab-file', 'tab-text', 'panel-file', 'panel-text', 'room-code', 'leave']) {
    assert.ok(htmlIds.has(id), `房间缺少 ${id}`);
  }
  assert.match(room[0], /id="tab-file"[^>]*>收发文件/);
  assert.match(room[0], /id="tab-text"[^>]*>发送文本/);
});

await test('HTML 里没有残留的占位路径', async () => {
  assert.ok(!html.includes('REPLACE_ME'));
});

console.log(lines.join('\n'));
console.log(process.exitCode ? '\n有失败用例' : '\n全部通过');
