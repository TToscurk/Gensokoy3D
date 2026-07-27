// 緣一的機動力 + 疾走動畫 + 火焰音效：
//   ① 一段跳約 2.8m、二段跳頂點約 5.8m（兩層樓）
//   ② 疾走速度 ≈ 其他角色的飛行速度（15 m/s 基礎 × speedMul）
//   ③ 疾走時擺出居合走り（身體前傾壓低、雙手在刀上），停下來就收
//   ④ 其他角色不受影響（跳躍/速度維持原值）
//   ⑤ 出招會建出火焰音效的節點
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
  await wait(3500);
  // 找一塊平地，免得地形起伏污染跳躍高度
  await evaljs(`(() => {
    const g = window.__gensokyo;
    g.player.teleport(-8, 14);
    window.__err = []; window.addEventListener('error', e => window.__err.push(String(e.message)));
    return 1;
  })()`);
  await wait(900);
};

await boot('緣一');

// --- ① 跳躍高度：直接模擬按 Space，量最高點 ---
const jump = await evaljs(`new Promise(res => {
  const g = window.__gensokyo, p = g.player;
  const y0 = p.pos.y;
  let peak1 = 0, peak2 = 0, frames = 0;
  // phase 0 = 已按下一段跳、還在地面 / 1 = 上升中 / 2 = 已補二段跳
  let phase = 0;
  p.pressed['Space'] = true;
  const tick = () => {
    const h = p.pos.y - y0;
    if (phase === 0) {
      // 一定要等真的離地才開始量 —— 站在地上 vel.y 恆為 0，
      // 直接拿 vel.y 判頂點會在第一幀就把二段跳也用掉
      if (!p.grounded) phase = 1;
    } else if (phase === 1) {
      peak1 = Math.max(peak1, h);
      if (p.vel.y <= 0) { p.pressed['Space'] = true; phase = 2; }   // 到頂再補
    } else {
      peak2 = Math.max(peak2, h);
      if (p.grounded) return res({ peak1: +peak1.toFixed(2), peak2: +peak2.toFixed(2) });
    }
    if (++frames > 600) return res({ peak1: +peak1.toFixed(2), peak2: +peak2.toFixed(2) });
    requestAnimationFrame(tick);
  };
  tick();
})`, true);
ck('一段跳約 2.8m', jump.peak1 > 2.3 && jump.peak1 < 3.3, `${jump.peak1}m`);
ck('二段跳頂點約兩層樓（5~7m）', jump.peak2 > 5 && jump.peak2 < 7.2, `${jump.peak2}m`);

// --- ② 疾走速度 ---
const run = await evaljs(`new Promise(res => {
  const g = window.__gensokyo, p = g.player;
  p.keys['KeyW'] = true; p.keys['ShiftLeft'] = true;
  let peak = 0, frames = 0;
  const tick = () => {
    peak = Math.max(peak, p.speedH);
    if (++frames > 150) {
      p.keys['KeyW'] = false; p.keys['ShiftLeft'] = false;
      return res({ peak: +peak.toFixed(1), flyBase: +(15 * p.speedMul).toFixed(1),
                   sprintMul: p.sprintMul, canFly: p.canFly });
    }
    requestAnimationFrame(tick);
  };
  tick();
})`, true);
ck('疾走速度 ≈ 飛行角色的巡航速度',
  Math.abs(run.peak - run.flyBase) < 1.2, `疾走 ${run.peak} m/s vs 飛行基礎 ${run.flyBase} m/s`);
ck('緣一仍然不會飛', run.canFly === false);

await wait(1200);

// --- ③ 疾走動畫 ---
const anim = await evaljs(`new Promise(res => {
  const g = window.__gensokyo, p = g.player, rig = p.model.userData.rig;
  p.keys['KeyW'] = true; p.keys['ShiftLeft'] = true;
  let frames = 0, sawRun = false, maxPitch = 0, legSwing = 0, minLeg = 9, maxLeg = -9;
  const tick = () => {
    if (p.speedH > 8.5) {
      sawRun = true;
      maxPitch = Math.max(maxPitch, rig.body.rotation.x);
      minLeg = Math.min(minLeg, rig.legL.rotation.x);
      maxLeg = Math.max(maxLeg, rig.legL.rotation.x);
    }
    if (++frames > 140) {
      p.keys['KeyW'] = false; p.keys['ShiftLeft'] = false;
      legSwing = maxLeg - minLeg;
      return res({ sawRun, maxPitch: +maxPitch.toFixed(2), legSwing: +legSwing.toFixed(2),
                   armRz: +rig.armR.rotation.z.toFixed(2) });
    }
    requestAnimationFrame(tick);
  };
  tick();
})`, true);
ck('疾走時身體壓低前傾', anim.sawRun && anim.maxPitch > 0.35, `軀幹前傾 ${anim.maxPitch} rad`);
ck('疾走時雙腿有循環擺動', anim.legSwing > 1.5, `擺幅 ${anim.legSwing} rad`);
ck('疾走時右手橫過身前按在刀上', anim.armRz < -0.4, `armR.z = ${anim.armRz}`);

await wait(1500);
const stopped = await evaljs(`(() => {
  const g = window.__gensokyo, rig = g.player.model.userData.rig;
  return { pitch: +rig.body.rotation.x.toFixed(3), speed: +g.player.speedH.toFixed(2) };
})()`);
ck('停下來就收回架式', Math.abs(stopped.pitch) < 0.05, JSON.stringify(stopped));

// --- ⑤ 火焰音效 ---
const audio = await evaljs(`(() => {
  const g = window.__gensokyo;
  const a = g.combat.audio;
  const hasFire = typeof a.fire === 'function';
  let made = 0;
  // 攔截 AudioContext 的節點生成，數一招會建出幾條音源
  const ctxProto = Object.getPrototypeOf(a._ensure ? a._ensure() : {});
  const real = ctxProto.createBufferSource;
  ctxProto.createBufferSource = function (...args) { made++; return real.apply(this, args); };
  g.combat.animT = -1; g.combat.formIndex = 12; g.combat.tryAttack();   // 終結技
  ctxProto.createBufferSource = real;
  return { hasFire, sources: made, state: a.ctx.state };
})()`);
ck('音效層有 fire()（火焰）', audio.hasFire === true);
ck('一招會疊出破空＋火焰轟＋爆裂三條音源', audio.sources >= 3, JSON.stringify(audio));

const errs = await evaljs(`(window.__err || []).length`);
ck('無 runtime 錯誤', errs === 0, `err=${errs}`);

// --- ④ 其他角色不受影響 ---
await boot('靈夢');
const reimu = await evaljs(`(() => {
  const p = window.__gensokyo.player;
  return { jumpV: p.jumpV, airJumpV: p.airJumpV, sprintMul: p.sprintMul,
           canFly: p.canFly, airJumps: p.maxAirJumps };
})()`);
ck('其他角色的跳躍/疾走維持原值',
  reimu.jumpV === 9.2 && reimu.airJumpV === 8.4 && reimu.sprintMul === 1.85,
  JSON.stringify(reimu));

console.log(`\n---- ${pass} PASS / ${fail} FAIL ----`);
page.close();
process.exit(fail ? 1 : 0);
