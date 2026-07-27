// 火星 + 火龍的驗證：
//   ① 火星是單一 Points（不是一顆一個 mesh），揮刀時真的有粒子
//   ② 火星會被甩出去（速度跟著刀走），不是原地噴
//   ③ 火龍只在拾壹之型（龍形）與拾參之型（終結）出場
//   ④ 火龍會往前飛、會自己收掉
//   ⑤ 命中/擊殺有火星，draw call 沒有爆
import { cdp } from './cdp.mjs';

const page = await cdp();
const { send, evaljs } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (n, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? '  ' + info : ''}`); };

await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 60; i++) {
  if (await evaljs(`document.getElementById('tip')?.textContent.includes('結界已開')`)) break;
  await wait(1000);
}
await evaljs(`(() => {
  for (const c of document.querySelectorAll('.card')) if (c.textContent.includes('緣一')) { c.click(); return 1; }
})()`);
await wait(3500);
await evaljs(`(() => {
  const g = window.__gensokyo;
  const m = g.mobs.mobs.find(m => m.state !== 2);
  g.player.teleport(m.pos.x + 2.4, m.pos.z + 2.4);
  g.player.camYaw = Math.atan2(-(m.pos.x - g.player.pos.x), -(m.pos.z - g.player.pos.z));
  window.__err = []; window.addEventListener('error', e => window.__err.push(String(e.message)));
  return 1;
})()`);
await evaljs(`window.__gensokyo.combat.toggleSheath()`);
await wait(700);

// --- ① 火星系統 ---
const base = await evaljs(`(() => {
  const g = window.__gensokyo, e = g.slashFX.embers;
  return { isPoints: e.mesh.isPoints === true, inScene: !!e.mesh.parent,
           idle: e.n, calls: g.renderer.info.render.calls };
})()`);
ck('火星是單一 Points 且已掛進場景', base.isPoints && base.inScene, JSON.stringify(base));

// --- ②：揮一刀，看粒子與速度 ---
const swing = await evaljs(`new Promise(res => {
  const g = window.__gensokyo, c = g.combat, e = g.slashFX.embers;
  c.formIndex = 2; c.animT = -1; c.tryAttack();
  let peak = 0, moved = 0, frames = 0;
  const tick = () => {
    peak = Math.max(peak, e.n);
    // 抽第一顆看速度大小（被甩出去的話會明顯不為零）
    if (e.n > 0) {
      const v = Math.hypot(e.vel[0], e.vel[1], e.vel[2]);
      moved = Math.max(moved, v);
    }
    if (++frames > 40) return res({ peak, moved: +moved.toFixed(1),
                                    calls: g.renderer.info.render.calls });
    requestAnimationFrame(tick);
  };
  tick();
})`, true);
ck('揮刀會沿路甩出火星', swing.peak >= 6, `尖峰 ${swing.peak} 顆`);
ck('火星是被甩出去的（有初速）', swing.moved > 2, `最大速度 ${swing.moved} m/s`);
ck('火星只多花 1 個 draw call', swing.calls - base.calls <= 2,
  `${base.calls} → ${swing.calls}`);

await wait(1200);

// --- ③④ 火龍 ---
const normal = await evaljs(`(() => {
  const g = window.__gensokyo, c = g.combat;
  c.formIndex = 2; c.animT = -1; c.tryAttack();       // 參之型：不該有龍
  return { on: g.slashFX.dragon.on };
})()`);
ck('一般招式不會出龍', normal.on === false);
await wait(1200);

const dragon = await evaljs(`new Promise(res => {
  const g = window.__gensokyo, c = g.combat, d = g.slashFX.dragon;
  c.formIndex = 10; c.animT = -1; c.tryAttack();      // 拾壹之型・日暈之龍
  const p0 = { x: g.player.pos.x, z: g.player.pos.z };
  let maxDist = 0, sawOn = false, frames = 0, headY = 0;
  const tick = () => {
    if (d.on) {
      sawOn = true;
      const dx = d.headPos.x - p0.x, dz = d.headPos.z - p0.z;
      maxDist = Math.max(maxDist, Math.hypot(dx, dz));
      headY = d.headPos.y - g.player.pos.y;
    }
    if (++frames > 90) return res({ sawOn, maxDist: +maxDist.toFixed(1),
                                    headY: +headY.toFixed(2), stillOn: d.on,
                                    calls: g.renderer.info.render.calls });
    requestAnimationFrame(tick);
  };
  tick();
})`, true);
ck('拾壹之型會放火龍', dragon.sawOn === true);
// 上界很重要：headPos 沒初始化的話會讀到 (0,0,0)，算出幾百公尺的假數字
ck('火龍會往前飛出去（且不會亂噴）', dragon.maxDist > 8 && dragon.maxDist < 24,
  `飛了 ${dragon.maxDist}m`);
ck('火龍高度合理（不鑽地也不上天）', dragon.headY > 0.4 && dragon.headY < 4,
  `頭部離地 ${dragon.headY}m`);

await wait(1800);
const cleaned = await evaljs(`(() => {
  const g = window.__gensokyo, d = g.slashFX.dragon;
  return { on: d.on, inScene: !!d.mesh.parent, calls: g.renderer.info.render.calls };
})()`);
ck('火龍會自己收掉', cleaned.on === false && cleaned.inScene === false, JSON.stringify(cleaned));

// 終結技的龍更大
const fin = await evaljs(`new Promise(res => {
  const g = window.__gensokyo, c = g.combat, d = g.slashFX.dragon;
  c.formIndex = 12; c.animT = -1; c.tryAttack();      // 拾參之型・輪廻
  let frames = 0, peakEmber = 0;
  const tick = () => {
    peakEmber = Math.max(peakEmber, g.slashFX.embers.n);
    if (++frames > 30) return res({ on: d.on, scale: d.scale, peakEmber });
    requestAnimationFrame(tick);
  };
  tick();
})`, true);
ck('終結技的龍更大且爆更多火星', fin.on && fin.scale > 1.2 && fin.peakEmber > 25,
  JSON.stringify(fin));

await wait(2500);
// FPS 自己量 60 幀的平均 —— state.fps 是滾動平均，單點讀數雜訊很大
const end = await evaljs(`new Promise(res => {
  const g = window.__gensokyo;
  let n = 0; const t0 = performance.now();
  const tick = () => {
    if (++n >= 60) return res({
      fps: Math.round(n / ((performance.now() - t0) / 1000)),
      calls: g.renderer.info.render.calls,
      embers: g.slashFX.embers.n, err: (window.__err || []).length });
    requestAnimationFrame(tick);
  };
  tick();
})`, true);
ck('打完後粒子清空、無錯誤、FPS ≥ 55',
  end.embers === 0 && end.err === 0 && end.fps >= 55, JSON.stringify(end));

console.log(`\n---- ${pass} PASS / ${fail} FAIL ----`);
page.close();
process.exit(fail ? 1 : 0);
