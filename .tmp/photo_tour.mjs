// 拍照巡迴：傳送到指定點、設定時刻、截圖。需先起 HTTP 伺服器 + headless Chrome。
// 用法: node .tmp/photo_tour.mjs
const CDP_PORT = 9223;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:8080'));
if (!page) { console.error('找不到頁面 target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
const errors = [];

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
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 400));
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push('CONSOLE.ERROR: ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 400));
  }
};
await new Promise(r => { ws.onopen = r; });
await send('Runtime.enable');
await send('Page.enable');

// 強制繞過 module 快取：每次用新的 query string 重載頁面
await send('Page.navigate', { url: `http://localhost:8080/?v=${Date.now()}` });

async function evaljs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) console.error('EVAL FAIL:', expr.slice(0, 80), JSON.stringify(r.exceptionDetails).slice(0, 300));
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
await wait(4000);

const { writeFileSync } = await import('fs');

// name, x, z, camYaw, time(分鐘)
const SHOTS = [
  ['shrine_sando_day',   855, -205, Math.PI, 840],   // 參道望向社殿
  ['shrine_stairs_day',  855, -325, Math.PI, 840],   // 石段中段仰望鳥居
  ['shrine_front_day',   855, -174, Math.PI, 840],   // 社殿正面特寫
  ['village_street_day', -125, 150, -Math.PI / 2, 840], // 村莊大街向東
  ['village_night',      -125, 150, -Math.PI / 2, 1380], // 同位置 23:00
  ['shrine_night',       855, -205, Math.PI, 1380],  // 神社夜
];

for (const [name, x, z, yaw, time] of SHOTS) {
  await evaljs(`(() => {
    const G = window.__gensokyo;
    G.sky.time = ${time};
    G.player.teleport(${x}, ${z});
    G.player.camYaw = ${yaw};
    return 1;
  })()`);
  await wait(2600);   // 等相機就位、晝夜插值收斂
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${(await import('os')).tmpdir()}/tour_${name}.png`, Buffer.from(shot.data, 'base64'));
  const stats = await evaljs(`window.__gensokyo.renderer.info.render.calls`);
  console.log(`shot ${name}  drawCalls=${stats}`);
}

console.log(errors.length ? `--- ${errors.length} errors ---\n` + errors.slice(0, 10).join('\n') : '--- no console errors ---');
ws.close();
process.exit(0);
