// 補測：守矢拜殿的進/出流程（門口有 NPC 時從室內側反向驗證）
const CDP_PORT = 9223;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:8080'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++mid;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  }
};
await new Promise(r => { ws.onopen = r; });
await send('Runtime.enable');
async function evaljs(expr, awaitP = false) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: awaitP });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result?.value;
}
const inr = JSON.parse(await evaljs(`(async () => {
  const s = await import('./src/world/structures.js');
  return JSON.stringify(s.INTERIORS.find(v => v.id === 'moriya-haiden'));
})()`, true));

// 直接站進室內落點 → 應看到「離開守矢神社拜殿」→ E → 回門外
await evaljs(`window.__gensokyo.player.teleport(${inr.inside.x}, ${inr.inside.z}, ${inr.inside.y}); undefined`);
await wait(400);
console.log('室內提示:', await evaljs(`document.querySelector('#prompt span').textContent`),
  '| on:', await evaljs(`document.getElementById('prompt').classList.contains('on')`));
await evaljs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); undefined`);
await wait(2900);
const pos = JSON.parse(await evaljs(`JSON.stringify(window.__gensokyo.player.pos)`));
const ok = Math.abs(pos.x - inr.exit.x) <= 1 && Math.abs(pos.z - inr.exit.z) <= 1;
console.log(ok ? 'PASS' : 'FAIL', '守矢離開落點', `(${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}) 預期 (${inr.exit.x}, ${inr.exit.z})`);

// 再從門口外側（避開 NPC 的 4.2m 對話圈邊緣）確認 enter 點確實存在
const near = JSON.parse(await evaljs(`(async () => {
  const i = await import('./src/world/interactives.js');
  const p = window.__gensokyo.player.pos;
  const it = i.INTERACTIVES.find(v => v.id === 'moriya-haiden:enter');
  return JSON.stringify({ x: it.x, z: it.z, to: it.to });
})()`, true));
console.log('moriya enter 點註冊:', JSON.stringify(near));
ws.close();
process.exit(ok ? 0 : 1);
