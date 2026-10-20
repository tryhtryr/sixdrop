const TTL_MS = 24 * 60 * 60 * 1000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * 一次中转上传的「分享页」。
 * 只存文件名 / 大小 / 对象 key，不存文件本身；下载时现签预签名 URL。
 * 24 小时后连同 R2 里的对象一起过期。
 */
export class Drop {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/init' && request.method === 'POST') {
      const existing = await this.ctx.storage.get('files');
      if (existing) return json({ error: 'taken' }, 409);

      const body = await request.json();
      await this.ctx.storage.put('files', body.files || []);
      await this.ctx.storage.put('createdAt', Date.now());
      await this.ctx.storage.setAlarm(Date.now() + TTL_MS);
      return json({ ok: true });
    }

    if (url.pathname === '/get') {
      const files = await this.ctx.storage.get('files');
      if (!files) return json({ error: 'not found' }, 404);
      return json({ files, createdAt: await this.ctx.storage.get('createdAt') });
    }

    if (url.pathname === '/del' && request.method === 'POST') {
      await this.ctx.storage.deleteAll();
      return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
