// 刀光（斬擊軌跡）驗證：
//   ① 出招時刀光帶的最新取樣點就貼在刀尖上（＝真的對齊刀身，不是腳下的固定扇形）
//   ② 一招掃出的軌跡長度夠（刀真的揮過去了）
//   ③ 起手/收招的慢動作不採樣（靜止不動時不會一直長尾巴）
//   ④ 招式結束後刀光收乾淨，不佔 draw call
//   ⑤ 沒刀的角色（靈夢）走舊的扇形 fallback，不會沒有特效
import { cdp } from './cdp.mjs';

const page = await cdp();
const { send, evaljs } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (n, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? '  ' + info : ''}`); };

const boot = async (who) => {
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 60; i++) {
    if (await evaljs(`document.getElementById('tip')?.textContent.includes('結界已開')`)) break;
    await wait(1000);
  }
  await evaljs(`(() => {
    for (const c of document.querySelectorAll('.card')) if (c.textContent.includes('${who}')) { c.click(); return 1; }
  })()`);
  await wait(3000);
  await evaljs(`(() => {
    const g = window.__gensokyo;
    const m = g.mobs.mobs.find(m => m.state !== 2);
    g.player.teleport(m.pos.x + 2.4, m.pos.z + 2.4);
    g.player.camYaw = Math.atan2(-(m.pos.x - g.player.pos.x), -(m.pos.z - g.player.pos.z));
    window.__err = []; window.addEventListener('error', e => window.__err.push(String(e.message)));
    return 1;
  })()`);
};

// ---------- 緣一：刀光 ----------
await boot('緣一');

// 先拔刀（不然第一招是拔刀斬，軌跡含出鞘段）
await evaljs(`window.__gensokyo.combat.toggleSheath()`);
await wait(900);

const probe = `(() => {
  const g = window.__gensokyo, t = g.slashFX._trail;
  const rig = g.player.model.userData.rig;
  g.player.model.updateMatrixWorld(true);
  const tip = rig.blade.localToWorld(new (rig.blade.position.constructor)(0, 1.07, 0));
  const head = t.buf[t.head];
  const live = t.buf.filter(s => s.age < 0.30).length;
  // 軌跡長度要在揮砍當下量 —— 招式結束後取樣點會全部過期歸零
  let L = 0, prev = null;
  for (let i = 0; i < t.buf.length; i++) {
    const s = t.buf[(t.head + 1 + i) % t.buf.length];
    if (s.age > 0.30) { prev = null; continue; }
    if (prev) L += prev.distanceTo(s.b);
    prev = s.b;
  }
  return { on: t.on, inScene: !!t.mesh?.parent, live, pathLen: +L.toFixed(2),
           tipGap: +head.b.distanceTo(tip).toFixed(3),
           headAge: +head.age.toFixed(3) };
})()`;

// 貳之型・碧羅之天（大上段劈落，軌跡最好認）
await evaljs(`(() => { const c = window.__gensokyo.combat; c.formIndex = 1; c.animT = -1; c.tryAttack(); return 1; })()`);

const frames = [];
for (let i = 0; i < 14; i++) { frames.push(await evaljs(probe)); await wait(28); }

const mid = frames.filter(f => f.live > 2);
const maxGap = mid.length ? Math.max(...mid.map(f => f.tipGap)) : 99;
ck('刀光最新取樣點貼在刀尖上', mid.length >= 3 && maxGap < 0.35,
  `取樣 ${mid.length} 幀，最大偏差 ${maxGap}m`);
ck('出招時刀光有進場', frames.some(f => f.inScene && f.live > 2),
  `最多同時 ${Math.max(...frames.map(f => f.live))} 個取樣點`);

// 軌跡總長：刀真的掃過一段距離
const pathLen = Math.max(...frames.map(f => f.pathLen));
ck('一招掃出的軌跡夠長', pathLen > 1.2, `${pathLen}m`);

// 招式結束後收乾淨
await wait(1200);
const after = await evaljs(`(() => {
  const g = window.__gensokyo, t = g.slashFX._trail;
  return { on: t.on, inScene: !!t.mesh?.parent, calls: g.renderer.info.render.calls };
})()`);
ck('招式結束後刀光收乾淨', after.on === false && after.inScene === false, JSON.stringify(after));

// 靜止不動不該一直採樣（慢動作門檻）
const idleGrow = await evaljs(`(() => {
  const g = window.__gensokyo, t = g.slashFX._trail;
  const h0 = t.head;
  g.slashFX.beginTrail({ });
  const rig = g.player.model.userData.rig;
  g.player.model.updateMatrixWorld(true);
  const V = rig.blade.position.constructor;
  const a = rig.blade.localToWorld(new V(0, 0.44, 0));
  const b = rig.blade.localToWorld(new V(0, 1.07, 0));
  for (let i = 0; i < 10; i++) g.slashFX.traceBlade(a, b);   // 同一個位置餵 10 次
  const n = t.buf.filter(s => s.age === 0).length;
  return n;
})()`);
ck('原地不動不會一直長尾巴', idleGrow <= 1, `同位置餵 10 次只留 ${idleGrow} 點`);

const yoriichi = await evaljs(`(() => {
  const g = window.__gensokyo;
  return { katana: g.combat.hasKatana, sectors: g.slashFX.slashes.length,
           fps: Math.round(g.state.fps || 0), err: (window.__err || []).length };
})()`);
ck('緣一不再放腳下的固定扇形', yoriichi.katana === true && yoriichi.sectors === 0, JSON.stringify(yoriichi));
ck('緣一場景無錯誤且 FPS ≥ 55', yoriichi.err === 0 && yoriichi.fps >= 55, JSON.stringify(yoriichi));

// ---------- 靈夢：無刀 fallback ----------
await boot('靈夢');
await evaljs(`(() => { const c = window.__gensokyo.combat; c.animT = -1; c.tryAttack(); return 1; })()`);
await wait(120);
const reimu = await evaljs(`(() => {
  const g = window.__gensokyo;
  return { katana: g.combat.hasKatana, sectors: g.slashFX.slashes.length,
           trailOn: g.slashFX._trail.on, err: (window.__err || []).length };
})()`);
ck('無刀角色仍有扇形斬擊特效',
  reimu.katana === false && reimu.sectors > 0 && reimu.trailOn === false, JSON.stringify(reimu));
ck('無刀角色場景無錯誤', reimu.err === 0, `err=${reimu.err}`);

console.log(`\n---- ${pass} PASS / ${fail} FAIL ----`);
page.close();
process.exit(fail ? 1 : 0);
