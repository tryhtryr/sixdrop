/**
 * 极简 markdown → HTML（只为把文章粘进富文本编辑器）
 *   node tools/md2html.mjs docs/juejin-post.md out.html "标题"
 */
import { readFile, writeFile } from 'node:fs/promises';

const [, , src, out, title] = process.argv;
const md = await readFile(src, 'utf8');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/&lt;(https?:\/\/[^&]+)&gt;/g, '<a href="$1">$1</a>');

const lines = md.split('\n');
const html = [];
let i = 0;

while (i < lines.length) {
  const line = lines[i];

  // 代码块
  if (line.startsWith('```')) {
    const lang = line.slice(3).trim();
    const buf = [];
    i += 1;
    while (i < lines.length && !lines[i].startsWith('```')) {
      buf.push(lines[i]);
      i += 1;
    }
    i += 1;
    html.push(
      `<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`,
    );
    continue;
  }

  // 标题
  const h = /^(#{1,4})\s+(.*)$/.exec(line);
  if (h) {
    const level = h[1].length;
    html.push(`<h${level}>${inline(h[2])}</h${level}>`);
    i += 1;
    continue;
  }

  // 表格
  if (line.startsWith('|') && lines[i + 1]?.includes('---')) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) {
      rows.push(lines[i]);
      i += 1;
    }
    const cells = (row) => row.split('|').slice(1, -1).map((c) => c.trim());
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    html.push(
      '<table><thead><tr>' +
        head.map((c) => `<th>${inline(c)}</th>`).join('') +
        '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>',
    );
    continue;
  }

  // 列表
  if (/^\s*[-*]\s+/.test(line)) {
    const items = [];
    while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
      items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
      i += 1;
    }
    html.push('<ul>' + items.map((t) => `<li>${inline(t)}</li>`).join('') + '</ul>');
    continue;
  }
  if (/^\s*\d+\.\s+/.test(line)) {
    const items = [];
    while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
      items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
      i += 1;
    }
    html.push('<ol>' + items.map((t) => `<li>${inline(t)}</li>`).join('') + '</ol>');
    continue;
  }

  // 引用 / 空行
  if (!line.trim()) {
    i += 1;
    continue;
  }
  if (line.startsWith('>')) {
    html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
    i += 1;
    continue;
  }
  if (line.trim() === '---') {
    html.push('<hr />');
    i += 1;
    continue;
  }

  // 段落
  const para = [line];
  i += 1;
  while (
    i < lines.length &&
    lines[i].trim() &&
    !/^(#{1,4})\s/.test(lines[i]) &&
    !lines[i].startsWith('```') &&
    !lines[i].startsWith('|') &&
    !/^\s*[-*]\s+/.test(lines[i]) &&
    !/^\s*\d+\.\s+/.test(lines[i])
  ) {
    para.push(lines[i]);
    i += 1;
  }
  html.push(`<p>${inline(para.join(' '))}</p>`);
}

const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(
  title || 'preview',
)}</title>
<style>
body{max-width:860px;margin:40px auto;padding:0 24px;font:16px/1.8 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1f2328}
h2{margin:36px 0 14px;font-size:26px;line-height:1.4}
h3{margin:26px 0 10px;font-size:20px}
p{margin:14px 0}
table{border-collapse:collapse;width:100%;margin:16px 0;font-size:15px}
th,td{border:1px solid #d0d7de;padding:8px 10px;text-align:left;vertical-align:top}
th{background:#f6f8fa}
pre{background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:14px 16px;overflow:auto}
code{font-family:ui-monospace,Consolas,monospace;font-size:14px;background:#f6f8fa;padding:1px 5px;border-radius:5px}
pre code{background:none;padding:0}
ul,ol{margin:14px 0;padding-left:26px}
li{margin:6px 0}
blockquote{margin:16px 0;padding:8px 16px;border-left:4px solid #d0d7de;color:#57606a}
a{color:#0969da}
hr{border:0;border-top:1px solid #d0d7de;margin:28px 0}
</style></head><body>${html.join('\n')}</body></html>`;

await writeFile(out, page, 'utf8');
console.log(`wrote ${out} (${page.length} chars, ${html.length} blocks)`);
