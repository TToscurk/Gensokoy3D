const CDP_PORT = 9223;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:8080'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++mid; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
};
await new Promise(r => { ws.onopen = r; });
await send('Runtime.enable');
async function evaljs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) console.error('FAIL', JSON.stringify(r.exceptionDetails).slice(0,300));
  return r.result?.value;
}
await evaljs(`window.__gensokyo.sky.time = 1380; 1`);
await wait(1500);
console.log(await evaljs(`(() => { const s = window.__gensokyo.sky;
  return JSON.stringify({
    time: s.time.toFixed(0),
    sunI: s.sun.intensity, sunCol: s.sun.color.getHexString(),
    sunPos: s.sun.position.toArray().map(v=>v.toFixed(0)),
    hemiI: s.hemi.intensity, hemiCol: s.hemi.color.getHexString(),
    hemiGround: s.hemi.groundColor.getHexString(),
    exposure: window.__gensokyo.renderer.toneMappingExposure,
    fog: s.scene.fog.color.getHexString(),
  }); })()`));
ws.close(); process.exit(0);
