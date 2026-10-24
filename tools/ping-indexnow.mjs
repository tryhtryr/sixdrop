/**
 * 用 IndexNow 通知 Bing / Yandex / Naver「这个 URL 变了，快来抓」。
 *   node tools/ping-indexnow.mjs
 *   node tools/ping-indexnow.mjs http://127.0.0.1:8787/ http://127.0.0.1:8787/xxx
 *
 * key 文件放在 public/<32位hex>.txt，内容就是 key 本身。
 */
import { readdir, readFile } from 'node:fs/promises';

const HOST = '127.0.0.1:8787';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const files = await readdir(`${root}public`);
const keyFile = files.find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) {
  console.error('✗ public/ 下没有找到 IndexNow 的 key 文件');
  process.exit(1);
}

const key = (await readFile(`${root}public/${keyFile}`, 'utf8')).trim();
const urls = process.argv.slice(2).filter(Boolean);
const urlList = urls.length ? urls : [`https://${HOST}/`];

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    host: HOST,
    key,
    keyLocation: `https://${HOST}/${keyFile}`,
    urlList,
  }),
});

console.log(`  IndexNow → ${res.status} （200/202 表示已接受）`);
console.log(`  提交了 ${urlList.length} 个 URL: ${urlList.join(', ')}`);
