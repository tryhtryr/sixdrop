/**
 * 百度普通收录 API 推送（每天有配额，只推新 URL）。
 *   BAIDU_TOKEN=xxx BAIDU_SITE=https://你的域名 node tools/ping-search.mjs
 *   BAIDU_TOKEN=xxx BAIDU_SITE=https://你的域名 node tools/ping-search.mjs https://你的域名/about
 *
 * 不带 URL 参数时，从 ${BAIDU_SITE}/sitemap.xml 读取。
 */
const TOKEN = process.env.BAIDU_TOKEN || '';
const SITE = (process.env.BAIDU_SITE || '').replace(/\/+$/, '');

if (!TOKEN) {
  console.error('缺少 BAIDU_TOKEN：百度搜索资源平台 → 资源提交 → API 提交 页面里的 token');
  process.exit(1);
}
if (!SITE) {
  console.error('缺少 BAIDU_SITE：例如 BAIDU_SITE=https://example.com');
  process.exit(1);
}

const urls = process.argv.slice(2).filter((u) => u.startsWith('http'));
if (!urls.length) {
  const res = await fetch(`${SITE}/sitemap.xml`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    console.error(`拿不到 ${SITE}/sitemap.xml：HTTP ${res.status}`);
    process.exit(1);
  }
  const xml = await res.text();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(m[1]);
}

console.log(`推送 ${urls.length} 条到 ${SITE}`);
for (const u of urls) console.log('  -', u);

// 百度官方示例用的是 http；本机 HTTPS 会拿到 baidu.com 的证书，TLS 校验过不去
// site 原样拼进去（百度控制台示例就是 site=https://域名，编码后反而会 site init fail）
const endpoint = `http://data.zz.baidu.com/urls?site=${SITE}&token=${TOKEN}`;
const res = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: urls.join('\n'),
  signal: AbortSignal.timeout(20000),
});

const text = await res.text();
let data = {};
try {
  data = JSON.parse(text);
} catch {
  console.log(`HTTP ${res.status}（非 JSON 响应）: ${text.slice(0, 200)}`);
}

console.log(`HTTP ${res.status}`, JSON.stringify(data));

if (data.success) console.log(`成功 ${data.success} 条，当天剩余配额 ${data.remain}`);
for (const key of ['not_same_site', 'not_valid', 'over_quota']) {
  if (data[key]?.length) console.log(`${key}:`, data[key].join(', '));
}
if (!data.success) {
  console.log('');
  console.log('提示：未备案站点的配额常常是 0（remain=0），这时只能靠手动提交和外链。');
}
