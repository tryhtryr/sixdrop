/**
 * 百度普通收录 API 推送（每天有配额，只推新 URL）。
 *   BAIDU_TOKEN=xxxx node tools/ping-search.mjs
 * 也支持只推一条： BAIDU_TOKEN=xxx node tools/ping-search.mjs https://sixdrop.dev/guide
 */
import { readFile } from 'node:fs/promises';

const TOKEN = process.env.BAIDU_TOKEN || '';
const SITE = process.env.BAIDU_SITE || 'sixdrop.dev';

if (!TOKEN) {
  console.error('缺少 BAIDU_TOKEN：在百度搜索资源平台 → 数据引入 → API 提交 里拿 token');
  process.exit(1);
}

const urls = process.argv.slice(2).filter((u) => u.startsWith('https://'));
if (!urls.length) {
  const xml = await readFile(new URL('../public/sitemap.xml', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'utf8');
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(m[1]);
}

console.log(`推送 ${urls.length} 条到 ${SITE}`);
for (const u of urls) console.log('  -', u);

const res = await fetch(`https://data.zz.baidu.com/urls?site=${SITE}&token=${TOKEN}`, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: urls.join('\n'),
});

const data = await res.json().catch(() => ({}));
console.log(`HTTP ${res.status}`, JSON.stringify(data));

if (data.success) console.log(`成功 ${data.success} 条，配额剩余 ${data.remain}`);
if (data.not_same_site) console.log('被拒（域名不一致）:', data.not_same_site.join(', '));
if (data.not_valid) console.log('被拒（不合法）:', data.not_valid.join(', '));
if (data.over_quota) console.log('超出配额:', data.over_quota.join(', '));
