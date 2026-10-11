// All push subscriptions + predicted moments live in ONE private blob, so the
// cron only needs a single read per run (Vercel Blob Hobby: 10k reads / 2k writes a month).
import { put, get } from '@vercel/blob';

export const INDEX = 'push/index.json';
const OPT = { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' };

export async function readIndex() {
  try {
    const r = await get(INDEX, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) return { devices: {} };
    const d = JSON.parse(await new Response(r.stream).text());
    return d && d.devices ? d : { devices: {} };
  } catch { return { devices: {} }; }
}
export const writeIndex = idx => put(INDEX, JSON.stringify(idx), OPT);
