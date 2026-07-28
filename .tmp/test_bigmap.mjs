// 大地圖連線圖 + 分圖小地圖驗收
// 1. 節點數 = 19（18 分圖 + legacy）  2. 現行節點有 .here
// 3. 連線有畫上（canvas 有非背景像素） 4. 點節點會 manager.load
// 5. 切圖後小地圖底圖換成該圖局部烘焙 6. 異界節點是 .remote 且用 gate 過場
import { cdp } from './cdp.mjs';
const { evaljs } = await cdp();
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  | ' + detail : ''}`);
  ok ? pass++ : fail++;
};

// 等遊戲 running
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
await wait(800);

// 開大地圖
await evaljs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' })); undefined`);
await wait(600);

const n1 = await evaljs(`document.querySelectorAll('#bigmap .lm').length`);
check('節點數 19', n1 === 19, `實得 ${n1}`);
const nRemote = await evaljs(`document.querySelectorAll('#bigmap .lm.remote').length`);
check('異界節點 3（紫點）', nRemote === 3, `實得 ${nRemote}`);
const nLegacy = await evaljs(`document.querySelectorAll('#bigmap .lm.legacy').length`);
check('舊世界節點 1', nLegacy === 1, `實得 ${nLegacy}`);

const here = await evaljs(`(() => {
  const el = document.querySelector('#bigmap .lm.here span');
  return el ? el.textContent : null;
})()`);
check('現行節點標 .here（神社）', here === '博麗神社', `實得 ${here}`);

// 連線：canvas 上除深色底外要有金色線像素
const edges = await evaljs(`(() => {
  const cv = document.getElementById('bigmapCanvas');
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let gold = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 60 && d[i+1] > 50 && d[i+2] < 80 && d[i] > d[i+2] + 20) gold++;
  }
  return gold;
})()`);
check('連線有畫上（金線像素）', edges > 200, `金像素 ${edges}`);

// 玩家標記在現行節點上
const meAt = await evaljs(`(() => {
  const me = document.querySelector('#bigmap .me');
  const here = document.querySelector('#bigmap .lm.here');
  return me.style.left === here.style.left && me.style.top === here.style.top;
})()`);
check('玩家標記釘在現行節點', meAt === true);

// 小地圖底圖：應是 shrine 的局部烘焙（224 寬）
const miniBase = await evaljs(`(() => {
  const b = window.__gensokyo.mapView.base;
  return b ? { w: b.cv.width, h: b.cv.height, mw: b.w } : null;
})()`);
check('小地圖底圖＝分圖局部烘焙', miniBase && miniBase.w === 224 && miniBase.mw <= 600,
  JSON.stringify(miniBase));

// 點「人間之里」節點 → 應切到 village
await evaljs(`(() => {
  for (const el of document.querySelectorAll('#bigmap .lm span')) {
    if (el.textContent.startsWith('人間之里')) { el.parentElement.click(); return true; }
  }
  return false;
})()`);
await wait(2500);
const id2 = await evaljs(`window.__gensokyo.manager.id`);
check('點節點傳送到 village', id2 === 'village', `實得 ${id2}`);
const miniBase2 = await evaljs(`(() => {
  const b = window.__gensokyo.mapView.base;
  return b ? { w: b.cv.width, mw: b.w, mh: b.h } : null;
})()`);
check('切圖後小地圖重烘（village 尺寸）', !!miniBase2, JSON.stringify(miniBase2));

// 重開大地圖：here 應換到人間之里
await evaljs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' })); undefined`);
await wait(500);
const here2 = await evaljs(`document.querySelector('#bigmap .lm.here span')?.textContent`);
check('here 跟著切換（人間之里）', here2 === '人間之里', `實得 ${here2}`);
await evaljs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' })); undefined`);
await wait(300);

// 點「舊世界」→ legacy_open（時光機）
await evaljs(`(() => {
  for (const el of document.querySelectorAll('#bigmap .lm.legacy')) { el.click(); return true; }
})()`);
await evaljs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' })); undefined`);
await wait(2500);
const id3 = await evaljs(`window.__gensokyo.manager.id`);
check('舊世界節點 → legacy_open', id3 === 'legacy_open', `實得 ${id3}`);
const miniBase3 = await evaljs(`window.__gensokyo.mapView.base?.cv.width`);
check('legacy 用世界烘焙 448', miniBase3 === 448, `實得 ${miniBase3}`);

// 回神社收尾
await evaljs(`(async () => { await window.__gensokyo.manager.load('shrine', null, { style: 'walk' }); return 1; })()`, true);
await wait(800);

console.log(`\n${fail === 0 ? '全部通過' : '有失敗項'} — ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
