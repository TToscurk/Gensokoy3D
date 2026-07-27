// 驗證截圖 v2：node .tmp/shot_at2.mjs <x> <z> <yaw> <pitch> <name> [dist] [time] [flyY]
// time: sky.time 固定值（600=朝, 780=午後）；flyY: 有給就開飛行並浮到該高度（拍湖面用）
const CDP_PORT = 9223;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const [x, z, yaw, pitch, name, dist, time, flyY] = process.argv.slice(2);
const T = time !== undefined ? Number(time) : 600;

const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:8080'));
if (!page) { console.error('找不到頁面'); process.exit(1); }
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
async function evaljs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) console.error('EVAL ERR:', JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}
console.log(await evaljs(`(() => {
  const G = window.__gensokyo;
  if (G.sky) { G.sky.time = ${T}; }
  ${flyY !== undefined ? `G.player.flying = true;` : ''}
  G.player.teleport(${x}, ${z});
  ${flyY !== undefined ? `G.player.pos.y = ${flyY}; G.player.vel.set(0,0,0);` : ''}
  G.player.camYaw = ${yaw};
  G.player.camPitch = ${pitch};
  ${dist !== undefined ? `G.player.camDist = ${dist}; G.player.camDistTarget = ${dist};` : ''}
  return 'teleported ' + JSON.stringify(G.player.pos);
})()`));
await wait(2500);
await evaljs(`window.__gensokyo.sky && (window.__gensokyo.sky.time = ${T});
  ${flyY !== undefined ? `var __shotp=window.__gensokyo.player; __shotp.pos.y=${flyY}; __shotp.vel.set(0,0,0);` : ''}`);
await wait(400);
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('fs');
writeFileSync(`C:/Users/B365/AppData/Local/Temp/shot_${name}.png`, Buffer.from(shot.data, 'base64'));
console.log('saved shot_' + name + '.png');
ws.close();
process.exit(0);
