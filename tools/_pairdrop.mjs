import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'C:\\Users\\jian\\Documents\\deepseek-harness\\default-workspace\\';
const log = (...args) => console.log(...args);

const b = await chromium.launch({ executablePath: EDGE, headless: true });

try {
  const ctxA = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxB = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await ctxA.newPage();
  const c = await ctxB.newPage();

  await a.goto('https://pairdrop.net/', { waitUntil: 'domcontentloaded' });
  await a.waitForTimeout(1500);
  await c.goto('https://pairdrop.net/', { waitUntil: 'domcontentloaded' });
  await c.waitForTimeout(1500);
  await a.waitForTimeout(4000);

  await a.screenshot({ path: OUT + 'pd-two-peers.png' });
  const peers = await a.evaluate(() => ({
    count: document.querySelectorAll('.peer').length,
    tiles: [...document.querySelectorAll('.peer')].map((el) => ({
      text: el.innerText.replace(/\n+/g, ' | ').slice(0, 80),
      cls: el.className,
    })),
    selfTile: document.querySelector('#x-peers')?.innerText.slice(0, 300),
  }));
  log('PEERS:', JSON.stringify(peers, null, 2));

  // 点对端，弹配对码
  const target = a.locator('.peer').first();
  if (await target.count()) {
    await target.click({ force: true });
    await a.waitForTimeout(1200);
    await a.screenshot({ path: OUT + 'pd-pairing.png' });
    const dlg = await a.evaluate(() => {
      const d = document.querySelector('#pair-device-dialog');
      return d ? { open: d.hasAttribute('open'), text: d.innerText.replace(/\n+/g, ' | ').slice(0, 400) } : null;
    });
    log('PAIR DIALOG:', JSON.stringify(dlg));
  }

  const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  await mp.goto('https://pairdrop.net/', { waitUntil: 'domcontentloaded' });
  await mp.waitForTimeout(3000);
  await mp.screenshot({ path: OUT + 'pd-mobile.png' });

  // 暗色主题也看一眼
  const d = await b.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const dp = await d.newPage();
  await dp.goto('https://pairdrop.net/', { waitUntil: 'domcontentloaded' });
  await dp.waitForTimeout(2500);
  await dp.screenshot({ path: OUT + 'pd-dark.png' });
} finally {
  await b.close();
}
log('done');
