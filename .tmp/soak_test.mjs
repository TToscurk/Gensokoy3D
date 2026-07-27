// 浸泡測試：長時間運行 + 四處傳送，每 10 秒採樣記憶體與 GPU 資源，
// 觀察是否持續成長（分頁被瀏覽器 OOM kill 的前兆）。
// 用法: node .tmp/soak_test.mjs [秒數]
const CDP_PORT = 9223;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:8080'));
if (!page) { console.error('找不到頁面 target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
const errors = [];
let crashed = false;

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
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  } else if (msg.method === 'Inspector.targetCrashed') {
    crashed = true;
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 400));
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push('CONSOLE.ERROR: ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 400));
  }
};
await new Promise(r => { ws.onopen = r; });
await send('Runtime.enable');
await send('Page.enable');
await send('Inspector.enable');

async function evaljs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) return null;
  return r.result?.value;
}

// 等開機
let booted = false;
for (let i = 0; i < 60; i++) {
  booted = await evaljs(`document.getElementById('tip')?.textContent.includes('結界已開')`);
  if (booted) break;
  await wait(1000);
}
console.log('boot:', booted ? 'OK' : 'TIMEOUT');
if (!booted) process.exit(1);
await evaljs(`document.querySelector('.card').click(); undefined`);
await wait(2000);

// 傳送路線：神社 → 村莊 → 紅魔館 → 魔法森林 → 神社…（逼草叢/植被重鋪、燈籠池切換）
const ROUTE = [
  [855, -174], [-125, 150], [-500, -500], [-100, -350],
  [855, -205], [-80, 130], [-540, -460], [60, 300],
];

const totalSec = Number(process.argv[2] || 180);
let hop = 0;
for (let t = 0; t < totalSec; t += 10) {
  if (crashed) { console.log(`*** t=${t}s 分頁崩潰（Inspector.targetCrashed）***`); break; }
  // 每 10 秒換一個位置，模擬玩家四處跑
  const [x, z] = ROUTE[hop++ % ROUTE.length];
  await evaljs(`(() => { const G = window.__gensokyo; G.player.teleport(${x}, ${z}); return 1; })()`);
  await wait(10000);
  const s = await evaljs(`(() => {
    const G = window.__gensokyo;
    const m = performance.memory;
    return JSON.stringify({
      heapMB: Math.round(m.usedJSHeapSize / 1048576),
      heapLimitMB: Math.round(m.jsHeapSizeLimit / 1048576),
      geo: G.renderer.info.memory.geometries,
      tex: G.renderer.info.memory.textures,
      prog: G.renderer.info.programs.length,
      fps: Math.round(G.state.fps),
    });
  })()`);
  if (s === null) { console.log(`*** t=${t + 10}s 頁面無回應（可能已崩潰）***`); crashed = true; break; }
  console.log(`t=${String(t + 10).padStart(3)}s  (${x},${z})  ${s}`);
}

console.log(crashed ? '*** 測試因崩潰中止 ***' : '--- 浸泡結束，未崩潰 ---');
console.log(errors.length ? `--- ${errors.length} errors ---\n` + errors.slice(0, 10).join('\n') : '--- no console errors ---');
ws.close();
process.exit(0);
