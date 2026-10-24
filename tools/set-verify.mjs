/**
 * 写入站点验证 meta（百度 / 搜狗 / 360）。
 *   node tools/set-verify.mjs baidu=codeva-xxxx sogou=yyyy
 *   node tools/set-verify.mjs --clear
 * 幂等：每次都先删掉旧的标记块再写入。
 */
import { readFile, writeFile } from 'node:fs/promises';

const PATH = 'E:\\sixdrop\\public\\index.html';
const START = '    <!-- 站点验证（set-verify 生成） -->';
const END = '    <!-- /站点验证 -->';

const META = {
  baidu: 'baidu-site-verification',
  sogou: 'sogou_site_verification',
  so360: '360-site-verification',
};

const args = process.argv.slice(2);
const values = {};
for (const arg of args) {
  const [key, ...rest] = arg.split('=');
  if (META[key] && rest.length) values[key] = rest.join('=');
}

let html = await readFile(PATH, 'utf8');

// 清掉旧块
const re = new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'm');
html = html.replace(re, '');

if (args.includes('--clear')) {
  await writeFile(PATH, html, 'utf8');
  console.log('已清除站点验证 meta');
  process.exit(0);
}

const lines = Object.entries(values).map(
  ([key, value]) => `    <meta name="${META[key]}" content="${value}" />`,
);

if (!lines.length) {
  console.error('用法：node tools/set-verify.mjs baidu=codeva-xxx sogou=yyy [so360=zzz]');
  process.exit(1);
}

const block = [START, ...lines, END].join('\n');
// 尽量贴近 <head> 开头：有的解析器只读响应前面一段
const anchor = /<meta charset="utf-8"\s*\/?>\n?/i.test(html)
  ? /<meta charset="utf-8"\s*\/?>\n?/i
  : /<head[^>]*>\n?/i;
html = html.replace(anchor, (m) => `${m}${block}\n`);

await writeFile(PATH, html, 'utf8');
console.log('已写入：');
for (const line of lines) console.log('  ' + line.trim());
