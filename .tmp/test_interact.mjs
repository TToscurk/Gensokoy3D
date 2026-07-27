// 批次 3 驗收：互動點 + fadeTeleport 實測
// 三處室內（進→室內 Y 落地→出回門外）、索道互傳、NPC 提示優先
// 用法: node .tmp/test_interact.mjs   （需 8080 伺服器 + 9223 headless Chrome）
const CDP_PORT = 9223;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:8080'));
if (!page) { console.error('找不到頁面 target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
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
  }
};
await new Promise(r => { ws.onopen = r; });
await send('Runtime.enable');

async function evaljs(expr, awaitP = false) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: awaitP });
  if (r.exceptionDetails) throw new Error('頁面例外: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result?.value;
}

// 等遊戲進入 running（e2e_check 跑過的話已在遊戲中）
let running = false;
for (let i = 0; i < 45; i++) {
  running = await evaljs(`window.__gensokyo?.state?.running === true`);
  if (running) break;
  const sel = await evaljs(`document.getElementById('select')?.classList.contains('on')`);
  if (sel) await evaljs(`document.querySelector('.card')?.click(); undefined`);
  await wait(1000);
}
if (!running) { console.error('遊戲未進入 running'); process.exit(1); }
console.log('game running: true');

// 拿 INTERIORS / WARP_NODES / INTERACTIVES 資料
const dataRaw = await evaljs(`(async () => {
  const s = await import('./src/world/structures.js');
  const i = await import('./src/world/interactives.js');
  return JSON.stringify({ interiors: s.INTERIORS, warps: s.WARP_NODES, reg: i.INTERACTIVES.map(v => ({ id: v.id, label: v.label })) });
})()`, true);
const { interiors, warps, reg } = JSON.parse(dataRaw);
console.log(`互動點註冊數: ${reg.length}（預期 ${interiors.length * 2 + warps.length}）`);
console.log('  ' + reg.map(v => v.id).join(', '));

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  | ' + detail : ''}`);
  ok ? pass++ : fail++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

async function pressE() {
  await evaljs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); undefined`);
  await wait(2900);   // fadeTeleport 全程約 2.1s
}
const getPos = () => evaljs(`JSON.stringify(window.__gensokyo.player.pos)`).then(JSON.parse);
const getPrompt = () => evaljs(`(() => ({
  on: document.getElementById('prompt').classList.contains('on'),
  text: document.querySelector('#prompt span').textContent
}))()`);

// ---------- 三處室內：進 → 出 ----------
for (const inr of interiors) {
  // 站到門口（enter 無 y，貼地即可；y 判定對 enter 不做）
  await evaljs(`window.__gensokyo.player.teleport(${inr.enter.x}, ${inr.enter.z}); undefined`);
  await wait(400);
  const pr = await getPrompt();
  const expectEnter = `進入${inr.zh}`;
  if (pr.text.startsWith('與 ')) {
    check(`${inr.id} 門口提示`, true, `顯示 NPC 對話（NPC 優先規則），跳過 E 流程`);
    continue;
  }
  check(`${inr.id} 門口提示`, pr.on && pr.text === expectEnter, `看到「${pr.text}」`);
  await pressE();
  let pos = await getPos();
  check(`${inr.id} 進入室內落點`,
    near(pos.x, inr.inside.x, 1) && near(pos.z, inr.inside.z, 1) && near(pos.y, inr.inside.y, 1),
    `落於 (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})，預期 y≈${inr.inside.y.toFixed(1)}`);
  await wait(300);
  const pr2 = await getPrompt();
  check(`${inr.id} 室內提示`, pr2.on && pr2.text === `離開${inr.zh}`, `看到「${pr2.text}」`);
  await pressE();
  pos = await getPos();
  check(`${inr.id} 離開回門外`,
    near(pos.x, inr.exit.x, 1) && near(pos.z, inr.exit.z, 1),
    `落於 (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)})`);
}

// ---------- 索道互傳 ----------
for (const w of warps) {
  const dest = warps.find(v => v.id === w.to);
  await evaljs(`window.__gensokyo.player.teleport(${w.x}, ${w.z}, ${w.y}); undefined`);
  await wait(400);
  const pr = await getPrompt();
  check(`${w.id} 月台提示`, pr.on && pr.text === w.label, `看到「${pr.text}」`);
  await pressE();
  const pos = await getPos();
  check(`${w.id} → ${w.to} 到站落點`,
    near(pos.x, dest.x, 1) && near(pos.z, dest.z, 1) && near(pos.y, dest.y, 1.2),
    `落於 (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})，預期 y≈${dest.y.toFixed(1)}`);
}

// ---------- NPC 優先：把玩家傳到一位 NPC 身旁 ----------
const npcInfo = JSON.parse(await evaljs(`(() => {
  const n = window.__gensokyo.npcs.npcs[0];
  return JSON.stringify({ x: n.pos.x, z: n.pos.z, zh: n.spec.zh });
})()`));
await evaljs(`window.__gensokyo.player.teleport(${npcInfo.x + 1.5}, ${npcInfo.z}); undefined`);
await wait(400);
const prNpc = await getPrompt();
check('NPC 身旁提示優先對話', prNpc.on && prNpc.text === `與 ${npcInfo.zh} 交談`, `看到「${prNpc.text}」`);

console.log(`\n${fail === 0 ? '全部通過' : '有失敗項'} — ${pass} pass / ${fail} fail`);
ws.close();
process.exit(fail === 0 ? 0 : 1);
