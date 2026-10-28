// Vercel serverless function: stores THE BRIDGE progress in Upstash Redis.
// Needs env vars: BRIDGE_KEY (your passphrase) and the Redis REST url/token
// that the Vercel Upstash integration adds (KV_REST_API_URL / KV_REST_API_TOKEN).
const crypto = require('crypto');
const KEY = 'bridge_state';

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function redis(cmd) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw Object.assign(new Error('no db'), { code: 503 });
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error('db ' + r.status);
  return (await r.json()).result;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.BRIDGE_KEY;
  if (!secret) { res.status(503).json({ error: 'BRIDGE_KEY not set' }); return; }
  if (!same(req.headers['x-bridge-key'] || '', secret)) { res.status(401).json({ error: 'bad key' }); return; }
  try {
    if (req.method === 'GET') {
      const v = await redis(['GET', KEY]);
      res.status(200).json({ state: v ? JSON.parse(v) : null });
      return;
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || !body.state || typeof body.state !== 'object') { res.status(400).json({ error: 'bad body' }); return; }
      const s = JSON.stringify(body.state);
      if (s.length > 900000) { res.status(413).json({ error: 'too large' }); return; }
      await redis(['SET', KEY, s]);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: 'method' });
  } catch (e) {
    res.status(e.code === 503 ? 503 : 500).json({ error: 'server' });
  }
};
