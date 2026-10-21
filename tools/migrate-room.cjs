/**
 * 把「首页标签 + 等待/确认/传输/聊天」四个视图并进一个房间视图。
 *
 *   node tools/migrate-room.cjs         # 试运行，只打印会做什么
 *   node tools/migrate-room.cjs --apply # 真正写入
 *
 * 设计要点：
 *  - 全程按 section 边界切分，不靠 class 正则
 *  - 先给首页的 tab/panel 改名成 start-*，避免和房间里的 id 撞车
 *  - show() 改成面板路由，传输逻辑一行不动
 */
const fs = require('node:fs');

const APPLY = process.argv.includes('--apply');
const HP = 'E:/sixdrop/public/index.html';
const AP = 'E:/sixdrop/public/app.js';

let h = fs.readFileSync(HP, 'utf8').replace(/\r\n/g, '\n');
let t = fs.readFileSync(AP, 'utf8').replace(/\r\n/g, '\n');
const log = (m) => console.log((APPLY ? '  [写入] ' : '  [预演] ') + m);

/* ---------- 0. 现状 ---------- */
const sections = [...h.matchAll(/<section id="view-([a-z]+)"/g)].map((m) => m[1]);
log(`现有视图：${sections.join(', ')}`);
for (const need of ['wait', 'ask', 'xfer', 'chat', 'start', 'error', 'relay']) {
  if (!sections.includes(need)) throw new Error(`缺少视图 ${need}，先别迁移`);
}

/* ---------- 1. 首页降级：tab/panel 改名 ---------- */
const renames = [
  ['id="tab-file"', 'id="start-tab-file"'],
  ['id="tab-text"', 'id="start-tab-text"'],
  ['id="panel-file"', 'id="start-panel-file"'],
  ['id="panel-text"', 'id="start-panel-text"'],
];
for (const [from, to] of renames) {
  const n = h.split(from).length - 1;
  log(`改名 ${from} → ${to}（${n} 处）`);
  h = h.split(from).join(to);
}

/* 首页里的 tab 逻辑也要跟着改，否则引用不到 */
const tabBlock = /function selectTab\(name\) \{[\s\S]*?\n\}\n/;
if (tabBlock.test(t)) {
  const m = t.match(tabBlock)[0];
  if (m.includes('start-tab-')) {
    log('selectTab() 已是 start- 版本，跳过');
  } else {
    t = t.replace(
      tabBlock,
      `function selectTab(name) {
  for (const tab of document.querySelectorAll('#view-start .tab')) {
    const active = tab.id === \`start-tab-\${name}\`;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  $('start-panel-file').hidden = name !== 'file';
  $('start-panel-text').hidden = name !== 'text';
}
`,
    );
    log('首页 selectTab() 已限定在 #view-start 内');
  }
}

/* ---------- 2. 切出四个视图 ---------- */
function cut(id) {
  const open = h.indexOf(`<section id="view-${id}"`);
  if (open < 0) throw new Error(`没有 view-${id}`);
  const tagEnd = h.indexOf('>', open) + 1;
  const close = h.indexOf('</section>', tagEnd);
  const inner = h.slice(tagEnd, close);
  h = h.slice(0, open) + h.slice(close + '</section>'.length);
  return inner;
}

const waitBody = cut('wait');
const askBody = cut('ask');
const xferBody = cut('xfer');
const chatBody = cut('chat');
log('已切出 wait/ask/xfer/chat 四段');

/* 等待页里的投递区和加入表单，留在文件面板顶部 */
const pickTag = (html, tag) => {
  const at = html.indexOf(`<${tag}`);
  if (at < 0) return '';
  const end = html.indexOf(`</${tag}>`, at) + `</${tag}>`.length;
  return html.slice(at, end);
};
const dropHtml = pickTag(waitBody, 'label');
const joinHtml = pickTag(waitBody.slice(waitBody.indexOf('<form')), 'form');
log(`投递区 ${dropHtml ? '有' : '无'} · 加入表单 ${joinHtml ? '有' : '无'}`);

/* ---------- 3. 组装房间 ---------- */
const room = `
      <section id="view-room" class="view card" hidden>
        <div class="room-head">
          <span class="room-code" id="room-code">------</span>
          <button class="link" id="copy-link">复制链接</button>
          <button class="link" id="cancel">离开</button>
        </div>

        <div class="tabs" role="tablist">
          <button class="tab is-active" id="room-tab-file" role="tab" aria-selected="true">收发文件</button>
          <button class="tab" id="room-tab-text" role="tab" aria-selected="false">发送文本</button>
        </div>

        <div id="panel-file">
          <div id="file-idle">
            <p class="muted small" id="wait-sub">等待对方输入取件码…</p>
${dropHtml}
${joinHtml}
          </div>
          <div id="file-ask" hidden>
${askBody}
          </div>
          <div id="file-progress" hidden>
${xferBody}
          </div>
        </div>

        <div id="panel-text" hidden>
${chatBody}
        </div>
      </section>
`;

const anchor = h.indexOf('      <section id="view-error"');
if (anchor < 0) throw new Error('找不到 view-error');
h = h.slice(0, anchor) + room + '\n' + h.slice(anchor);

/* ---------- 4. show() 改面板路由 ---------- */
const showAt = t.indexOf('function show(name) {');
if (showAt < 0) throw new Error('没找到 show()');
const showEnd = t.indexOf('\n}', showAt) + 2;

const router = `function roomSelectTab(tab) {
  const text = tab === 'text';
  const f = $('room-tab-file');
  const x = $('room-tab-text');
  if (!f || !x) return;
  f.classList.toggle('is-active', !text);
  x.classList.toggle('is-active', text);
  f.setAttribute('aria-selected', String(!text));
  x.setAttribute('aria-selected', String(text));
  $('panel-file').hidden = text;
  $('panel-text').hidden = !text;
  if (text) setTimeout(() => $('chat-input')?.focus(), 60);
}

function setFilePanel(state) {
  $('file-idle').hidden = state !== 'idle';
  $('file-ask').hidden = state !== 'ask';
  $('file-progress').hidden = state !== 'progress';
}

const PANEL_OF = {
  wait: ['file', 'idle'],
  ask: ['file', 'ask'],
  xfer: ['file', 'progress'],
  chat: ['text', null],
};

function show(name) {
  const mapped = PANEL_OF[name];
  for (const el of document.querySelectorAll('.view')) {
    el.hidden = mapped ? el.id !== 'view-room' : el.id !== \`view-\${name}\`;
  }
  if (!mapped) return;
  roomSelectTab(mapped[0]);
  if (mapped[1]) setFilePanel(mapped[1]);
}`;

t = t.slice(0, showAt) + router + t.slice(showEnd);

/* ---------- 5. 自检 ---------- */
const ids = [...h.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const dup = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
if (dup.length) throw new Error(`合并后 id 重复：${dup.join(', ')}`);
log(`id 检查通过（共 ${ids.length} 个，无重复）`);

const used = [...t.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
const missing = [...new Set(used)].filter((u) => !ids.includes(u));
if (missing.length) throw new Error(`JS 引用了不存在的 id：${missing.join(', ')}`);
log('JS 引用的 id 都存在');

if (APPLY) {
  fs.writeFileSync(HP, h, 'utf8');
  fs.writeFileSync(AP, t, 'utf8');
  log('已写入 index.html / app.js');
} else {
  log('预演完成，加 --apply 才真正写入');
}
