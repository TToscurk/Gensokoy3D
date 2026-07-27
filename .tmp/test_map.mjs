// 地圖系統驗證：重載 → 選角 → 小地圖有內容 → M 開大地圖（17 地標）→
// 點人間之里傳送 → 找緣一開主線 → 大地圖出現任務金點 → 效能
import { cdp } from './cdp.mjs';

const TMP = (await import('os')).tmpdir();   // 原本寫死作者機器的路徑
const page = await cdp();
const { send, evaljs, shot } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));
const key = code => evaljs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}' })); undefined`);
let fails = 0;
const check = (name, ok) => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}`); if (!ok) fails++; };

// 重載 + 開機
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.reload', { ignoreCache: true });
let booted = false;
for (let i = 0; i < 60; i++) {
  booted = await evaljs(`document.getElementById('tip')?.textContent.includes('結界已開')`);
  if (booted) break;
  await wait(1000);
}
console.log('boot:', booted ? 'OK' : 'TIMEOUT');
if (!booted) { page.close(); process.exit(1); }
await evaljs(`document.querySelector('.card').click(); undefined`);
await wait(3000);

// 1. MapView 存在、底圖烘好
const core = await evaljs(`(() => {
  const mv = window.__gensokyo.mapView;
  return { exists: !!mv, bake: mv?.baked?.width ?? 0 };
})()`);
check('MapView 已建立', core.exists);
check(`底圖烘焙 (${core.bake}px)`, core.bake >= 256);

// 2. 小地圖真的畫了東西（不是全透明）
await wait(500);
const mini = await evaljs(`(() => {
  const c = document.getElementById('minimap');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let opaque = 0, sum = 0;
  for (let i = 3; i < d.length; i += 4) { if (d[i] > 0) { opaque++; sum += d[i - 3] + d[i - 2] + d[i - 1]; } }
  return { opaque, avg: opaque ? Math.round(sum / opaque / 3) : 0 };
})()`);
check(`小地圖已繪製（${mini.opaque} 像素，均亮 ${mini.avg}）`, mini.opaque > 20000 && mini.avg > 20);

// 3. M 開大地圖
await key('KeyM');
await wait(400);
const big = await evaljs(`(() => {
  const w = document.getElementById('bigmap');
  return { on: w.classList.contains('on'), landmarks: w.querySelectorAll('.lm').length,
           playerLocked: !window.__gensokyo.player.enabled };
})()`);
check('大地圖開啟', big.on);
check(`地標數 ${big.landmarks}/17`, big.landmarks === 17);
check('開圖時玩家操作鎖住', big.playerLocked);
await shot(TMP + '/map_big.png');

// 4. 點「人間之里」傳送
await evaljs(`(() => {
  for (const b of document.querySelectorAll('#bigmap .lm'))
    if (b.textContent.includes('人間之里')) { b.click(); return true; }
  return false;
})()`);
await wait(600);
const tp = await evaljs(`(() => {
  const p = window.__gensokyo.player.pos;
  return { x: Math.round(p.x), z: Math.round(p.z),
           closed: !document.getElementById('bigmap').classList.contains('on'),
           unlocked: window.__gensokyo.player.enabled };
})()`);
check(`傳送到人間之里 (${tp.x}, ${tp.z})`, Math.abs(tp.x - -80) < 120 && Math.abs(tp.z - 150) < 160);
check('傳送後地圖關閉且解鎖', tp.closed && tp.unlocked);

// 5. 開主線 → 任務金點出現（找緣一說話；scene 直接 Esc 關掉）
await evaljs(`(() => {
  const g = window.__gensokyo;
  const n = g.npcs.npcs.find(v => v.spec.id === 'yoriichi');
  g.player.teleport(n.root.position.x + 1.5, n.root.position.z + 1.5);
  return true;
})()`);
await wait(300);
await key('KeyE');
await wait(400);
await key('Escape');
await wait(300);
const obj = await evaljs(`JSON.stringify(window.__gensokyo.quests.mapObjectives())`);
console.log('  任務目標:', obj);
const objArr = JSON.parse(obj);
check('主線目標指向靈夢', objArr.some(o => o.npc === 'reimu' && o.main));

await key('KeyM');
await wait(1100);   // 金點 1Hz 快取，等一拍
const qm = await evaljs(`(() => {
  const w = document.getElementById('bigmap');
  return { n: w.querySelectorAll('.qm').length, main: w.querySelectorAll('.qm.main').length };
})()`);
check(`大地圖任務金點 ${qm.n}（主線 ${qm.main}）`, qm.n >= 1 && qm.main >= 1);
await shot(TMP + '/map_quest.png');
await key('KeyM');
await wait(300);

// 6. 小地圖也有金點（重查像素裡的金色）
const miniGold = await evaljs(`(() => {
  const c = document.getElementById('minimap');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let gold = 0;
  for (let i = 0; i < d.length; i += 4)
    if (d[i] > 230 && d[i + 1] > 180 && d[i + 2] < 140) gold++;
  return gold;
})()`);
check(`小地圖任務金點（${miniGold} 金色像素）`, miniGold > 4);
await shot(TMP + '/map_mini.png');

// 7. 效能
const perf = await evaljs(`(() => {
  const i = window.__gensokyo.renderer.info.render;
  return { fps: Math.round(window.__gensokyo.state.fps), calls: i.calls };
})()`);
check(`效能 ${perf.fps} FPS / ${perf.calls} draws`, perf.fps >= 55);

// 收尾：別污染其他測試（test_interact 不重載頁面）
await evaljs(`(() => {
  const g = window.__gensokyo;
  g.mapView.close();
  g.player.enabled = true;
  return true;
})()`);

console.log(fails === 0 ? 'PASS 地圖驗證通過' : `FAIL ×${fails}`);
page.close();
process.exit(fails === 0 ? 0 : 1);
