import webpush from 'web-push';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { readIndex, writeIndex } from '../lib/pushIndex.js';

// Called every ~10 min by a GitHub Actions workflow (authenticated with GitHub's OIDC token,
// no shared secret in the public repo) and once a day by Vercel Cron (CRON_SECRET).
// It only READS the index; it sends the moments that fell due since the previous run.
const REPO = 'designer2-ragga/manual-ragga';
const JWKS = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));

async function authorized(req) {
  const h = req.headers.authorization || '';
  if (process.env.CRON_SECRET && h === `Bearer ${process.env.CRON_SECRET}`) return true;
  if (!h.startsWith('Bearer ')) return false;
  try {
    const { payload } = await jwtVerify(h.slice(7), JWKS, { issuer: 'https://token.actions.githubusercontent.com', audience: 'fantasmagotchi' });
    return payload.repository === REPO;
  } catch { return false; }
}

export default async function handler(req, res) {
  if (!(await authorized(req))) return res.status(401).end();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
  const now = Date.now();
  let since = Date.parse(String(req.query.since || '')) || now - 15 * 60_000;
  since = Math.max(since, now - 2 * 3600_000);
  const idx = await readIndex();
  let sent = 0, gone = false;
  await Promise.all(Object.entries(idx.devices).map(async ([id, d]) => {
    const due = (d.items || []).filter(i => i.at > since && i.at <= now + 30_000);
    if (!due.length) return;
    const last = due[due.length - 1]; // one buzz per phone per run
    try {
      await webpush.sendNotification(d.sub, JSON.stringify(last), { TTL: 3600, urgency: 'high' });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { delete idx.devices[id]; gone = true; }
      else console.error(id, e.statusCode || e.message);
    }
  }));
  if (gone) await writeIndex(idx);
  res.status(200).json({ ok: true, sent, since: new Date(since).toISOString() });
}
