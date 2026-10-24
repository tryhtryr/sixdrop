/**
 * 用 IndexNow 通知 Bing / Yandex / Naver / Seznam「这些 URL 变了，快来抓」。
 *   SITE_URL=https://sixdrop.dev node tools/ping-indexnow.mjs
 *   SITE_URL=https://sixdrop.dev node tools/ping-indexnow.mjs https://sixdrop.dev/about
 *
 * key 文件放在 public/<32位hex>.txt，内容就是 key 本身；
 * 不带 URL 参数时从 ${SITE_URL}/sitemap.xml 读取。
 */
import { readdir, readFile } from 'node:fs/promises';

const SITE = (process.env.SITE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const HOST = new URL(SITE).host;
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const files = await readdir(`${root}public`);
const keyFile = files.find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) {
  console.error('✗ public/ 下没有找到 IndexNow 的 key 文件（32 位 hex 的 .txt）');
  process.exit(1);
}

const key = (await readFile(`${root}public/${keyFile}`, 'utf8')).trim();
const args = process.argv.slice(2).filter((u) => u.startsWith('http'));

let urlList = args;
if (!urlList.length) {
  const res = await fetch(`${SITE}/sitemap.xml`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    console.error(`✗ 拿不到 ${SITE}/sitemap.xml：HTTP ${res.status}`);
    process.exit(1);
  }
  const xml = await res.text();
  urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

console.log(`IndexNow → host=${HOST} keyFile=${keyFile} urls=${urlList.length}`);
for (const u of urlList) console.log('  -', u);

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: HOST,
    key,
    keyLocation: `${SITE}/${keyFile}`,
    urlList,
  }),
  signal: AbortSignal.timeout(20000),
});

console.log(`HTTP ${res.status}（200/202 表示已接受，403 是 key 校验失败，422 是 URL 不属于该 host）`);
