import { AwsClient } from 'aws4fetch';

// R2 单次 PUT 上限 5 GiB，留 64 MiB 余量给签名和头
const SINGLE_LIMIT = 5 * 1024 ** 3 - 64 * 1024 ** 2;
const MAX_OBJECT = 5 * 1024 ** 4 - 128 * 1024 ** 3;
const MAX_PARTS = 10000;
// 分片下限 64 MiB：既远高于 R2 的 5 MiB 底线，又避免几 GiB 的文件被切成上千片
const MIN_PART = 64 * 1024 ** 2;
const URL_TTL = 3600;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

function config(env) {
  const account = env.R2_ACCOUNT_ID;
  const bucket = env.R2_BUCKET;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  if (!account || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    client: new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: 's3',
      region: 'auto',
    }),
  };
}

function encodeKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

function safeName(name) {
  const base = String(name || 'file')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .trim();
  const cut = base.slice(-120);
  return cut || 'file';
}

function objectUrl(cfg, key) {
  return `${cfg.endpoint}/${cfg.bucket}/${encodeKey(key)}`;
}

async function presign(cfg, method, key, query = {}) {
  const url = new URL(objectUrl(cfg, key));
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

  const signed = await cfg.client.sign(url.toString(), {
    method,
    aws: { signQuery: true, expires: URL_TTL },
  });
  return signed.url;
}

/** 给已上传的对象现签一个下载链接（分享页用） */
export async function presignGet(env, key) {
  const cfg = config(env);
  if (!cfg) throw new Error('relay 未配置');
  return presign(cfg, 'GET', key);
}

/** 删对象；已经不存在也算成功 */
export async function deleteObject(env, key) {
  const cfg = config(env);
  if (!cfg) throw new Error('relay 未配置');
  const res = await cfg.client.fetch(objectUrl(cfg, key), { method: 'DELETE' });
  return res.ok || res.status === 404;
}

function choosePartSize(size) {
  const byCount = Math.ceil(size / MAX_PARTS);
  const size2 = Math.max(MIN_PART, byCount);
  // 向上取整到 MiB，避免最后一片过小
  return Math.ceil(size2 / 1024 ** 2) * 1024 ** 2;
}

async function createMultipart(cfg, key) {
  const res = await cfg.client.fetch(`${objectUrl(cfg, key)}?uploads`, { method: 'POST' });
  const text = await res.text();
  if (!res.ok) throw new Error(`创建分片上传失败: ${res.status} ${text.slice(0, 200)}`);

  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(text)?.[1];
  if (!uploadId) throw new Error('没有拿到 UploadId');
  return uploadId;
}

export async function handleRelay(request, env, url) {
  if (url.pathname === '/api/relay/status') {
    return json({ enabled: Boolean(config(env)), maxSingle: SINGLE_LIMIT, maxObject: MAX_OBJECT });
  }

  const cfg = config(env);
  if (!cfg) return json({ error: 'relay 未配置' }, 503);

  try {
    if (url.pathname === '/api/relay/sign' && request.method === 'POST') {
      const body = await request.json();
      const size = Number(body.size);
      const name = safeName(body.name);

      if (!Number.isFinite(size) || size <= 0) return json({ error: 'bad size' }, 400);
      if (size > MAX_OBJECT) return json({ error: 'too large' }, 413);

      const key = `r/${crypto.randomUUID()}/${name}`;

      if (size <= SINGLE_LIMIT) {
        return json({ mode: 'put', key, url: await presign(cfg, 'PUT', key) });
      }

      const uploadId = await createMultipart(cfg, key);
      const partSize = choosePartSize(size);
      const count = Math.ceil(size / partSize);
      if (count > MAX_PARTS) return json({ error: 'too many parts' }, 413);

      const urls = [];
      for (let i = 0; i < count; i += 1) {
        urls.push(await presign(cfg, 'PUT', key, { partNumber: i + 1, uploadId }));
      }

      return json({ mode: 'multipart', key, uploadId, partSize, urls });
    }

    if (url.pathname === '/api/relay/complete' && request.method === 'POST') {
      const body = await request.json();
      const key = String(body.key || '');
      const uploadId = String(body.uploadId || '');
      const parts = Array.isArray(body.parts) ? body.parts : [];

      if (!key || !uploadId || !parts.length) return json({ error: 'bad request' }, 400);

      const xml =
        '<CompleteMultipartUpload>' +
        parts
          .map(
            (p) =>
              `<Part><PartNumber>${Number(p.partNumber)}</PartNumber><ETag>${String(p.etag).replace(
                /[<>&]/g,
                '',
              )}</ETag></Part>`,
          )
          .join('') +
        '</CompleteMultipartUpload>';

      const res = await cfg.client.fetch(
        `${objectUrl(cfg, key)}?uploadId=${encodeURIComponent(uploadId)}`,
        { method: 'POST', body: xml, headers: { 'content-type': 'application/xml' } },
      );

      if (!res.ok) {
        return json({ error: `合并分片失败: ${res.status}`, detail: (await res.text()).slice(0, 300) }, 502);
      }

      return json({ key, url: await presign(cfg, 'GET', key) });
    }

    if (url.pathname === '/api/relay/abort' && request.method === 'POST') {
      const body = await request.json();
      const key = String(body.key || '');
      const uploadId = String(body.uploadId || '');
      if (!key || !uploadId) return json({ error: 'bad request' }, 400);

      await cfg.client.fetch(`${objectUrl(cfg, key)}?uploadId=${encodeURIComponent(uploadId)}`, {
        method: 'DELETE',
      });
      return json({ ok: true });
    }

    if (url.pathname === '/api/relay/link' && request.method === 'GET') {
      const key = url.searchParams.get('key') || '';
      if (!key.startsWith('r/')) return json({ error: 'bad key' }, 400);
      return json({ url: await presign(cfg, 'GET', key) });
    }
  } catch (err) {
    return json({ error: err?.message || String(err) }, 500);
  }

  return json({ error: 'not found' }, 404);
}
