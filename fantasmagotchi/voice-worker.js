/* Neural voice: Piper (VITS, open model, MIT) running on ONNX Runtime Web inside a worker.
   Voice: pt_BR-faber-medium. Files are cached with the Cache API after the first download. */
importScripts('vendor/ort.min.js', 'vendor/piper-phonemize.js');

const MODEL = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx';
const PW = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
const CACHE = 'fg-voice-v1';
ort.env.wasm.wasmPaths = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/';
ort.env.wasm.numThreads = 1;

let session, cfg, WASM, DATA, loading;
const progress = {};

async function cached(url, label) {
  const c = await caches.open(CACHE);
  const hit = await c.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const total = +res.headers.get('content-length') || 0;
  const rd = res.body.getReader();
  const parts = [];
  let got = 0, last = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value); got += value.length;
    progress[label] = { got, total };
    if (got - last > 400000) { last = got; report(); }
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  await c.put(url, new Response(buf));
  progress[label] = { got, total: got };
  report();
  return buf;
}
function report() {
  let got = 0, total = 0;
  for (const k in progress) { got += progress[k].got; total += progress[k].total || progress[k].got; }
  postMessage({ type: 'progress', got, total: Math.max(total, 82e6) });
}
function load() {
  if (!loading) loading = (async () => {
    cfg = JSON.parse(new TextDecoder().decode(await cached(MODEL + '.json', 'cfg')));
    const [m, w, d] = await Promise.all([cached(MODEL, 'model'), cached(PW + '.wasm', 'wasm'), cached(PW + '.data', 'data')]);
    WASM = w.buffer; DATA = d.buffer;
    session = await ort.InferenceSession.create(m);
    postMessage({ type: 'ready' });
  })().catch(e => { loading = null; throw e; });
  return loading;
}
function phonemize(text) {
  return new Promise((res, rej) => {
    let done = false;
    self.createPiperPhonemize({
      print: l => { if (!done) { done = true; res(JSON.parse(l).phoneme_ids); } },
      printErr: () => {},
      wasmBinary: WASM,
      getPreloadedPackage: () => DATA,
      locateFile: l => l.endsWith('.wasm') ? PW + '.wasm' : PW + '.data',
    }).then(m => m.callMain(['-l', cfg.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']))
      .catch(rej);
  });
}
async function isCached() {
  try { const c = await caches.open(CACHE); return !!(await c.match(MODEL)); } catch { return false; }
}

onmessage = async e => {
  const { id, cmd, text, speed } = e.data;
  try {
    if (cmd === 'probe') { postMessage({ id, type: 'probe', cached: await isCached() }); return; }
    await load();
    if (cmd === 'load') { postMessage({ id, type: 'done' }); return; }
    const ids = await phonemize(text);
    const feeds = {
      input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([cfg.inference.noise_scale, cfg.inference.length_scale * (speed || 1), cfg.inference.noise_w]), [3]),
    };
    if (cfg.speaker_id_map && Object.keys(cfg.speaker_id_map).length) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
    const out = await session.run(feeds);
    const pcm = new Float32Array(out.output.data);
    postMessage({ id, type: 'audio', pcm, rate: cfg.audio.sample_rate }, [pcm.buffer]);
  } catch (err) {
    postMessage({ id, type: 'error', msg: String((err && err.message) || err) });
  }
};
