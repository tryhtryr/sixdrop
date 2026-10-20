/**
 * 把 SVG 渲染成各种尺寸的 PNG（用本机 Edge，不装额外依赖）。
 *   node tools/render-logo.mjs
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = `${ROOT}public/logo`;
const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function shot(svgPath, size, file) {
  const raw = await readFile(svgPath, 'utf8').then((s) => s.replace(/^\\uFEFF/, '').trimStart());
  // 直接改 SVG 的宽高属性，交给浏览器按目标尺寸布局，避免 CSS 尺寸和视口不同步导致裁切
  const svg = raw
    .replace(/\swidth="\d+"/, ` width="${size}"`)
    .replace(/\sheight="\d+"/, ` height="${size}"`);

  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;height:100%;overflow:hidden;background:transparent}
      body{display:grid;place-items:center}
      svg{display:block;width:${size}px;height:${size}px}
    </style></head><body>${svg}</body></html>`,
  );
  await page.waitForTimeout(100);
  // 圆角之外保持透明，避免出现白色四角
  await page.screenshot({
    path: `${OUT}/${file}`,
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  console.log(`  ${file}  ${size}×${size}`);
}

const icon = `${ROOT}public/icon.svg`;
await shot(icon, 512, 'icon-512.png');
await shot(icon, 192, 'icon-192.png');
await shot(icon, 180, 'apple-touch-icon.png');
await shot(icon, 32, 'favicon-32.png');

await browser.close();
