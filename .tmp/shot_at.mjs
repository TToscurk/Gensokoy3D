// 傳送到指定點截圖：node .tmp/shot_at.mjs <x> <z> <yaw> <pitch> <name> [camH] [dist] [py]
// py = 玩家腳底高度（室內/月台用；不給就貼地形）
const CDP_PORT = 9223;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const [x, z, yaw, pitch, name, camH, dist, py] = process.argv.slice(2);

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
  return r.result?.value;
}
// 直接改玩家座標與相機（用除錯掛鉤）；sky.time 600=早晨，時間流速會繼續走，所以拍前固定
console.log(await evaljs(`(() => {
  const G = window.__gensokyo;
  if (G.sky) { G.sky.time = 600; }
  G.player.teleport(${x}, ${z}${py !== undefined ? `, ${py}` : ''});
  G.player.camYaw = ${yaw};
  G.player.camPitch = ${pitch};
  ${dist !== undefined ? `G.player.camDist = ${dist}; G.player.camDistTarget = ${dist};` : ''}
  return 'teleported';
})()`));
await wait(2500);
await evaljs(`window.__gensokyo.sky && (window.__gensokyo.sky.time = 600)`);
await wait(400);
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('fs');
writeFileSync(`C:/Users/B365/AppData/Local/Temp/shot_${name}.png`, Buffer.from(shot.data, 'base64'));
console.log('saved shot_' + name + '.png');
ws.close();
process.exit(0);
