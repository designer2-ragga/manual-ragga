import { readIndex, writeIndex } from '../lib/pushIndex.js';

const ID = /^[a-z0-9]{16,48}$/;
const clean = (s, n) => String(s ?? '').slice(0, n);

export default async function handler(req, res) {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = String(body.id || '');
    if (!ID.test(id)) return res.status(400).json({ error: 'bad id' });
    const idx = await readIndex();
    const now = Date.now();
    // forget phones that went silent for 3 weeks
    for (const k of Object.keys(idx.devices)) if (now - (idx.devices[k].updated || 0) > 21 * 864e5) delete idx.devices[k];

    if (req.method === 'DELETE' || body.off) {
      delete idx.devices[id];
      await writeIndex(idx);
      return res.status(200).json({ ok: true, off: true });
    }
    if (req.method !== 'POST') return res.status(405).end();
    const sub = body.sub;
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys) return res.status(400).json({ error: 'bad subscription' });
    const items = (Array.isArray(body.items) ? body.items : [])
      .filter(i => Number.isFinite(i.at) && i.at > now - 60_000 && i.at < now + 7 * 864e5)
      .slice(0, 24)
      .map(i => ({ at: Math.round(i.at), title: clean(i.title, 40), body: clean(i.body, 160), tag: clean(i.tag, 24) }));
    idx.devices[id] = {
      sub: { endpoint: sub.endpoint, keys: { p256dh: clean(sub.keys.p256dh, 200), auth: clean(sub.keys.auth, 100) } },
      items, updated: now,
    };
    await writeIndex(idx);
    return res.status(200).json({ ok: true, count: items.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server' });
  }
}
