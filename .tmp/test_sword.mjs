// 拔刀系統 + 十三型各自動作的驗證。
//
// 全部用「刀尖/刀身中點的世界座標」驗，不靠眼睛：
//   ① 骨架有 blade/sheath/handR/foreR，且刀鞘留在腰上不動
//   ② 收鞘時刀身與鞘重合；拔刀播完刀在右手上
//   ③ 十三型每一型：刀尖不插進地面、確實伸得出去、刀身不穿過軀幹
//   ④ 會轉圈的招式收招時軀幹 yaw 必須回到 2π 的整數倍（否則人停在歪的方向）
//   ⑤ 十三型的刀尖軌跡兩兩不同（＝動作真的不一樣，不是同一段曲線換名字）
import { cdp } from './cdp.mjs';

const page = await cdp();
const { send, evaljs } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (name, ok, info = '') => {
  (ok ? pass++ : fail++);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
};

// --- 重載開機 ---
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.reload', { ignoreCache: true });
let booted = false;
for (let i = 0; i < 60; i++) {
  booted = await evaljs(`document.getElementById('tip')?.textContent.includes('結界已開')`);
  if (booted) break;
  await wait(1000);
}
if (!booted) { console.log('boot TIMEOUT'); page.close(); process.exit(1); }

await evaljs(`(() => {
  for (const c of document.querySelectorAll('.card')) if (c.textContent.includes('緣一')) { c.click(); return 1; }
})()`);
await wait(3000);

// --- ① 骨架 ---
const rig = await evaljs(`(() => {
  const r = window.__gensokyo.player.model.userData.rig;
  return { blade: !!r.blade, sheath: !!r.sheath, handR: !!r.handR, foreR: !!r.foreR,
           bladeName: r.blade?.name, sheathChildren: r.sheath?.children.length };
})()`);
ck('骨架有 blade/sheath/handR/foreR',
  rig.blade && rig.sheath && rig.handR && rig.foreR, JSON.stringify(rig));

// --- 探針：手動擺姿勢並讀刀的世界座標 ---
const probe = `
window.__sw = window.__sw || await (async () => {
  const M = await import('/src/combat/motion.js');
  const THREE = await import('three');
  const g = window.__gensokyo;
  const rig = g.player.model.userData.rig;
  const TIP = new THREE.Vector3(0, 1.07, 0);      // 刀尖（BLADE_LEN + 切先）
  const MID = new THREE.Vector3(0, 0.50, 0);      // 刀身中點
  const sample = (name, k, drawn) => {
    g.combat.drawn = drawn;
    const pose = M.poseFor(name, k);
    M.applyPose(rig, pose);
    g.combat._updateBlade(pose);
    g.player.model.updateMatrixWorld(true);
    const tip = rig.blade.localToWorld(TIP.clone());
    const mid = rig.blade.localToWorld(MID.clone());
    const o   = rig.blade.getWorldPosition(new THREE.Vector3());
    const p   = g.player.pos;
    return {
      tipY: +(tip.y - p.y).toFixed(3),
      tipR: +Math.hypot(tip.x - p.x, tip.z - p.z).toFixed(3),
      midR: +Math.hypot(mid.x - p.x, mid.z - p.z).toFixed(3),
      midY: +(mid.y - p.y).toFixed(3),
      ox: +(o.x - p.x).toFixed(3), oy: +(o.y - p.y).toFixed(3), oz: +(o.z - p.z).toFixed(3),
      yaw: pose.yaw ?? 0,
    };
  };
  return { M, THREE, rig, sample };
})();
`;

// 探針要 import 模組 → 一定得等 promise（cdp.evaljs 預設不等）
const run = async expr => evaljs(`(async () => { ${probe} const S = window.__sw; ${expr} })()`, true);

// --- ② 收鞘重合 / 拔刀入手 ---
const sheathChk = await run(`
  const g = window.__gensokyo;
  S.M.applyPose(S.rig, S.M.NEUTRAL);
  g.combat.drawn = false;
  g.combat._updateBlade(S.M.NEUTRAL);
  g.player.model.updateMatrixWorld(true);
  const b = S.rig.blade.getWorldPosition(new S.THREE.Vector3());
  const s = S.rig.sheath.getWorldPosition(new S.THREE.Vector3());
  const d = S.rig.blade.quaternion.angleTo(S.rig.sheath.quaternion);
  return { gap: +b.distanceTo(s).toFixed(4), angle: +d.toFixed(4) };
`);
ck('收鞘時刀身與鞘重合', sheathChk.gap < 0.005 && sheathChk.angle < 0.01, JSON.stringify(sheathChk));

const drawEnd = await run(`
  const g = window.__gensokyo;
  const pose = S.M.poseFor('draw', 1);
  g.combat.drawn = true;
  S.M.applyPose(S.rig, pose);
  g.combat._updateBlade(pose);
  g.player.model.updateMatrixWorld(true);
  const o = S.rig.blade.getWorldPosition(new S.THREE.Vector3());
  const h = S.rig.handR.getWorldPosition(new S.THREE.Vector3());
  return { handGap: +o.distanceTo(h).toFixed(3) };
`);
ck('拔刀播完刀握在右手', drawEnd.handGap < 0.22, JSON.stringify(drawEnd));

// 拔刀過程：①鞘要真的後引再回位 ②刀被抓住之後不能離手（不然是「刀飄在半空」）
const drawFlow = await run(`
  const g = window.__gensokyo;
  const out = [];
  for (let i = 0; i <= 20; i++) {
    const k = i / 20;
    const pose = S.M.poseFor('draw', k);
    g.combat.drawn = true;
    S.M.applyPose(S.rig, pose);
    g.combat._updateBlade(pose);
    g.player.model.updateMatrixWorld(true);
    const o = S.rig.blade.getWorldPosition(new S.THREE.Vector3());
    const h = S.rig.handR.getWorldPosition(new S.THREE.Vector3());
    const sBase = S.rig.sheath.userData.base.pos;
    out.push({ k: +k.toFixed(2), attach: +(pose.attach ?? 1).toFixed(2),
               handGap: +o.distanceTo(h).toFixed(3),
               sheathShift: +S.rig.sheath.position.distanceTo(sBase).toFixed(3) });
  }
  return out;
`);
const maxPull = Math.max(...drawFlow.map(r => r.sheathShift));
const endPull = drawFlow[drawFlow.length - 1].sheathShift;
ck('拔刀時鞘有後引、收招回原位', maxPull > 0.4 && endPull < 0.02,
  `最大後引 ${maxPull}m / 收招殘留 ${endPull}m`);
const heldGap = Math.max(...drawFlow.filter(r => r.attach > 0.5).map(r => r.handGap));
ck('刀被抓住後全程不離手', heldGap < 0.25, `離手最遠 ${heldGap}m`);

// --- ③④⑤ 十三型逐型掃描 ---
const forms = await evaljs(
  `import('/src/combat/forms.js').then(m => m.FORMS.map(f => [f.name, f.motion]))`, true);
ck('十三型都指定了 motion', forms.length === 13 && forms.every(f => f[1]),
  forms.filter(f => !f[1]).map(f => f[0]).join(',') || 'all set');

const uniqMotions = new Set(forms.map(f => f[1]));
ck('十三型的動作互不重複', uniqMotions.size === 13, `${uniqMotions.size}/13`);

const tracks = {};
for (const [name, motion] of forms) {
  const t = await run(`
    const out = [];
    for (let i = 0; i <= 20; i++) out.push(S.sample('${motion}', i / 20, true));
    return out;
  `);
  tracks[motion] = t;

  const minTipY = Math.min(...t.map(s => s.tipY));
  const maxTipR = Math.max(...t.map(s => s.tipR));
  const endYaw = t[t.length - 1].yaw;
  const yawOff = Math.abs(endYaw / (Math.PI * 2) - Math.round(endYaw / (Math.PI * 2)));
  // 「穿過身體」＝刀身中點落在軀幹那一段高度、又貼在身體軸線上。
  // 單看水平距離會誤殺舉刀過頭（刀在頭頂正上方，距離小但沒穿身）。
  const thruBody = t.filter(s => s.midR < 0.17 && s.midY > 0.62 && s.midY < 1.45).length;

  const ok = minTipY > 0.02 && maxTipR > 0.9 && thruBody === 0 && yawOff < 1e-3;
  ck(name.padEnd(18), ok,
    `刀尖最低 ${minTipY.toFixed(2)}m / 最遠 ${maxTipR.toFixed(2)}m / 穿身格數 ${thruBody} / 收招yaw ${endYaw.toFixed(2)}`);
}

// 兩兩軌跡差異（刀尖 21 個取樣點的平均距離）——證明 13 型不是同一段動作
let minPairDiff = 1e9, minPair = '';
const names = Object.keys(tracks);
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const a = tracks[names[i]], b = tracks[names[j]];
    let s = 0;
    for (let n = 0; n < a.length; n++) {
      s += Math.abs(a[n].tipY - b[n].tipY) + Math.abs(a[n].tipR - b[n].tipR);
    }
    s /= a.length;
    if (s < minPairDiff) { minPairDiff = s; minPair = `${names[i]}↔${names[j]}`; }
  }
}
ck('十三型刀尖軌跡兩兩有差異', minPairDiff > 0.15,
  `最接近的一對 ${minPair} 差 ${minPairDiff.toFixed(3)}m`);

// --- 實機連打 + FPS + 錯誤 ---
await evaljs(`(() => {
  const g = window.__gensokyo;
  const m = g.mobs.mobs.find(m => m.state !== 2);
  g.player.teleport(m.pos.x + 2.2, m.pos.z + 2.2);
  g.player.camYaw = Math.atan2(-(m.pos.x - g.player.pos.x), -(m.pos.z - g.player.pos.z));
  g.combat.formIndex = 0;
  window.__err = [];
  window.addEventListener('error', e => window.__err.push(String(e.message)));
})()`);

// 連打節奏：在頁面內每幀試著出招（＝玩家瘋狂點擊），
// CDP 來回的延遲會污染時間量測，所以整段跑在頁面裡。
const tempo = await evaljs(`new Promise(res => {
  const c = window.__gensokyo.combat;
  const stamps = [], forms = [];
  let blockedWhileBusy = 0, t0 = 0;
  const tick = () => {
    const wasBusy = c.busy;
    const f = c.tryAttack();
    if (f) {
      if (!t0) t0 = performance.now();
      stamps.push(performance.now() - t0);
      forms.push(c.animDur);        // 實際播放長度（已含倍速），比 f.dur 更貼近真相
    } else if (wasBusy) blockedWhileBusy++;
    if (stamps.length >= 14) return res({ stamps, forms, blockedWhileBusy });
    requestAnimationFrame(tick);
  };
  tick();
})`, true);

// 每一招的間隔應該就是上一招的動作長度（重擊/終結技會被 hitstop 稍微拉長）
const gaps = tempo.stamps.slice(1).map((t, i) => ({
  gap: (t - tempo.stamps[i]) / 1000, dur: tempo.forms[i],
}));
const bad = gaps.filter(g => g.gap < g.dur * 0.9 || g.gap > g.dur + 0.25);
ck('出招間隔＝動作播放長度（沒有多餘冷卻）', bad.length === 0,
  bad.length ? bad.map(g => `${g.gap.toFixed(2)}s vs dur ${g.dur}`).join(' / ')
             : `13 段間隔，最短 ${Math.min(...gaps.map(g => g.gap)).toFixed(2)}s / 最長 ${Math.max(...gaps.map(g => g.gap)).toFixed(2)}s`);
ck('動作播放中點擊會被擋下', tempo.blockedWhileBusy > 50,
  `被擋 ${tempo.blockedWhileBusy} 次`);
const after = await evaljs(`(() => {
  const g = window.__gensokyo;
  return { swings: g.combat.stats.swings, hits: g.combat.stats.hits, kills: g.combat.stats.kills,
           drawn: g.combat.drawn, fps: Math.round(g.state.fps || 0), err: (window.__err || []).length };
})()`);
ck('連打 14 招全部出招', after.swings >= 14, JSON.stringify(after));
ck('連打後刀維持出鞘', after.drawn === true);
ck('沒有 runtime 錯誤', after.err === 0, `err=${after.err}`);
ck('FPS ≥ 55', after.fps >= 55, `fps=${after.fps}`);

// 自動納刀：停手 6 秒
await wait(6500);
const idle = await evaljs(`(() => {
  const g = window.__gensokyo;
  const r = g.player.model.userData.rig;
  const b = r.blade.getWorldPosition(new (window.__sw.THREE.Vector3)());
  const s = r.sheath.getWorldPosition(new (window.__sw.THREE.Vector3)());
  return { drawn: g.combat.drawn, gap: +b.distanceTo(s).toFixed(3) };
})()`);
ck('停手 5 秒後自動納刀', idle.drawn === false && idle.gap < 0.02, JSON.stringify(idle));

console.log(`\n---- ${pass} PASS / ${fail} FAIL ----`);
page.close();
process.exit(fail ? 1 : 0);
