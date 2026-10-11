import { put, get } from '@vercel/blob';
import webpush from 'web-push';
import { readIndex } from '../lib/pushIndex.js';

const ID = /^[a-z0-9]{16,48}$/;
const OPT = { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' };
const PICKS = ['jack', 'bat', 'ghost'];
const BEATS = { jack: 'bat', bat: 'ghost', ghost: 'jack' }; // abóbora > morcego > fantasma > abóbora

async function rd(p) {
  try {
    const r = await get(p, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return JSON.parse(await new Response(r.stream).text());
  } catch { return null; }
}
const wr = (p, d) => put(p, JSON.stringify(d), OPT);
const codeOf = id => id.slice(0, 6).toUpperCase();
const pairPath = (a, b) => `pairs/${[a, b].sort().join('_')}.json`;
const freshDuel = (a, b) => ({ round: 0, picks: {}, score: { [a]: 0, [b]: 0 }, last: null, done: null });
const s = (v, n) => String(v ?? '').slice(0, n);

function cleanSnap(x) {
  if (!x || typeof x !== 'object') return null;
  return {
    name: s(x.name, 10), owner: s(x.owner, 12), kind: x.kind === 'pumpkin' ? 'pumpkin' : 'ghost',
    stage: ['egg', 'baby', 'child', 'teen', 'adult'].includes(x.stage) ? x.stage : 'baby',
    hunger: +x.hunger || 0, happy: +x.happy || 0, sick: +x.sick || 0, asleep: !!x.asleep, dead: !!x.dead,
  };
}

async function notify(id, title, body) {
  try {
    const idx = await readIndex();
    const p = idx.devices[id];
    if (!p || !p.sub) return;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
    await webpush.sendNotification(p.sub, JSON.stringify({ title, body, tag: 'friend' }), { TTL: 3600, urgency: 'high' });
  } catch (e) { console.error('notify', e.statusCode || e.message); }
}

function duelView(d, me, them) {
  if (!d) return null;
  const last = d.last ? { me: d.last.picks[me], them: d.last.picks[them], win: d.last.win === me ? 'me' : d.last.win === them ? 'them' : 'tie' } : null;
  return {
    round: d.round, score: { me: d.score[me] || 0, them: d.score[them] || 0 },
    mine: !!d.picks[me], theirs: !!d.picks[them], last,
    done: d.done ? (d.done === me ? 'me' : 'them') : null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = String(body.id || '');
    if (!ID.test(id)) return res.status(400).json({ error: 'id' });
    const action = String(body.action || 'sync');
    const now = Date.now();

    let me = await rd(`devices/${id}.json`);
    let dirty = false;
    if (!me) {
      me = { id, code: codeOf(id), snap: null, friend: null, inbox: [], at: 0 };
      await wr(`codes/${me.code}.json`, { id });
      dirty = true;
    }
    const sn = cleanSnap(body.snap);
    if (sn && (JSON.stringify(sn) !== JSON.stringify(me.snap)) && (now - (me.at || 0) > 30 * 60_000 || !me.snap || action !== 'sync')) {
      me.snap = sn; me.at = now; dirty = true;
    }
    const myName = (me.snap && me.snap.name) || 'Seu amigo';
    const myOwner = (me.snap && me.snap.owner) || myName;

    let friend = me.friend ? await rd(`devices/${me.friend}.json`) : null;
    let pair = friend ? await rd(pairPath(id, friend.id)) : null;

    if (action === 'pair') {
      const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const c = await rd(`codes/${code}.json`);
      if (!c || c.id === id) return res.status(404).json({ error: 'código não encontrado' });
      const fr = await rd(`devices/${c.id}.json`);
      if (!fr) return res.status(404).json({ error: 'código não encontrado' });
      me.friend = fr.id; fr.friend = id; dirty = true;
      await wr(`devices/${fr.id}.json`, fr);
      friend = fr;
      pair = await rd(pairPath(id, fr.id));
      if (!pair) { pair = { friendship: 0, duel: freshDuel(id, fr.id) }; await wr(pairPath(id, fr.id), pair); }
      await notify(fr.id, myName, `${myOwner} se conectou com você! 💜`);
    } else if (action === 'unpair') {
      me.friend = null; friend = null; pair = null; dirty = true;
    } else if (action === 'gift') {
      if (!friend) return res.status(409).json({ error: 'sem amigo' });
      friend.inbox = (friend.inbox || []).concat({ type: 'gift', from: myName, owner: myOwner, at: now }).slice(-20);
      await wr(`devices/${friend.id}.json`, friend);
      if (pair) { pair.friendship = Math.min(99, (pair.friendship || 0) + 1); await wr(pairPath(id, friend.id), pair); }
      await notify(friend.id, friend.snap ? friend.snap.name : 'Fantasmagotchi', `Ganhei um doce de ${myName}! 🍬`);
    } else if (action === 'duel' || action === 'duelReset') {
      if (!friend || !pair) return res.status(409).json({ error: 'sem amigo' });
      let d = pair.duel || freshDuel(id, friend.id);
      if (action === 'duelReset' || d.done) d = freshDuel(id, friend.id);
      if (action === 'duel') {
        const pk = String(body.pick);
        if (!PICKS.includes(pk)) return res.status(400).json({ error: 'pick' });
        if (!d.picks[id]) {
          d.picks[id] = pk;
          const theirs = d.picks[friend.id];
          if (theirs) {
            const win = BEATS[pk] === theirs ? id : BEATS[theirs] === pk ? friend.id : null;
            d.round++;
            d.last = { picks: { ...d.picks }, win };
            if (win) d.score[win] = (d.score[win] || 0) + 1;
            d.picks = {};
            if ((d.score[id] || 0) >= 3 || (d.score[friend.id] || 0) >= 3) {
              d.done = (d.score[id] || 0) >= 3 ? id : friend.id;
              pair.friendship = Math.min(99, (pair.friendship || 0) + 2);
            }
            await notify(friend.id, friend.snap ? friend.snap.name : 'Duelo', d.done ? 'O duelo acabou! Vem ver quem venceu ⚔️' : 'Rodada do duelo resolvida! Sua vez ⚔️');
          } else {
            await notify(friend.id, friend.snap ? friend.snap.name : 'Duelo', `${myName} jogou uma carta no duelo! ⚔️`);
          }
        }
      }
      pair.duel = d;
      await wr(pairPath(id, friend.id), pair);
    }

    const inbox = me.inbox || [];
    if (inbox.length) { me.inbox = []; dirty = true; }
    if (dirty) await wr(`devices/${id}.json`, me);

    res.status(200).json({
      code: me.code,
      friend: friend ? { code: friend.code, snap: friend.snap } : null,
      pair: pair ? { friendship: pair.friendship || 0, duel: duelView(pair.duel, id, friend.id) } : null,
      inbox,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
}
