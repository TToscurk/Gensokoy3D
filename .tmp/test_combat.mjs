// 戰鬥系統驗證：重載 → 選緣一 → 傳送到妖精窩 →
// 連出 13 招驗證型輪迴、命中/擊殺/連擊、截圖特效、FPS
import { cdp } from './cdp.mjs';

const TMP = (await import('os')).tmpdir();   // 原本寫死作者機器的路徑
const page = await cdp();
const { send, evaljs, shot } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));

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

// 選緣一（PLAYABLE 第 4 張卡）
const picked = await evaljs(`(() => {
  const cards = document.querySelectorAll('.card');
  for (const c of cards) if (c.textContent.includes('緣一')) { c.click(); return 'yoriichi'; }
  cards[0].click(); return 'fallback';
})()`);
console.log('角色:', picked);
await wait(3000);
console.log('running:', await evaljs(`window.__gensokyo.state.running`));

// 傳送到魔法之森第一個妖精窩旁
const tp = await evaljs(`(() => {
  const g = window.__gensokyo;
  const m = g.mobs.mobs.find(m => m.state !== 2);
  const p = g.player;
  p.teleport(m.pos.x + 2.2, m.pos.z + 2.2);
  // 相機面向那隻妖精
  const dx = m.pos.x - p.pos.x, dz = m.pos.z - p.pos.z;
  p.camYaw = Math.atan2(-dx, -dz);
  return { mob: m.i, px: p.pos.x.toFixed(1), pz: p.pos.z.toFixed(1), near: g.mobs.aliveNear(p.pos, 20) };
})()`);
console.log('傳送:', JSON.stringify(tp));

// 連出 13 招：消冷卻連打，驗證型輪迴
const seq = await evaljs(`(() => {
  const c = window.__gensokyo.combat;
  const names = [];
  for (let i = 0; i < 14; i++) {
    c.animT = -1;
    const f = c.tryAttack();
    names.push(f ? f.name : '(被擋)');
  }
  return { names, stats: c.stats, next: c.formIndex };
})()`);
console.log('出招序列:'); seq.names.forEach((n, i) => console.log(`  ${String(i + 1).padStart(2)}. ${n}`));
console.log('stats:', JSON.stringify(seq.stats), 'nextIndex:', seq.next);

// 截圖：出一招大的（十一型），等相機 lerp 落定再出招，抓斬弧最亮的瞬間
await evaljs(`(() => {
  const g = window.__gensokyo, c = g.combat, p = g.player;
  const m = g.mobs.mobs.find(m => m.state !== 2 &&
    Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z) < 25);
  if (m) {
    const dx = m.pos.x - p.pos.x, dz = m.pos.z - p.pos.z;
    p.camYaw = Math.atan2(-dx, -dz);
  }
  p.camDist = 4.2; p.camDistTarget = 4.2; p.camPitch = 0.18;
  return true;
})()`);
await wait(1600);
await evaljs(`(() => {
  const c = window.__gensokyo.combat;
  c.formIndex = 10; c.animT = -1;
  c.tryAttack();
  return true;
})()`);
await wait(120);
await shot(TMP + '/combat_slash.png');

// 連擊與 UI 狀態
const ui = await evaljs(`({
  banner: document.getElementById('formBanner').textContent,
  bannerOn: document.getElementById('formBanner').classList.contains('on'),
  combo: document.getElementById('combo').querySelector('.n').textContent,
  comboOn: document.getElementById('combo').classList.contains('on'),
  kills: window.__gensokyo.mobs.kills,
})`);
console.log('UI:', JSON.stringify(ui));

await wait(1500);
const fps = await evaljs(`(() => {
  const i = window.__gensokyo.renderer.info.render;
  return { fps: Math.round(window.__gensokyo.state.fps), calls: i.calls, tris: i.triangles };
})()`);
console.log('效能:', JSON.stringify(fps));

const pass = seq.names.length === 14 && !seq.names.includes('(被擋)')
  && seq.names[0].includes('壹之型') && seq.names[12].includes('拾參之型') && seq.names[13].includes('壹之型')
  && seq.stats.hits > 0 && ui.kills > 0 && ui.banner.includes('日暈之龍');
console.log(pass ? 'PASS 戰鬥驗證通過' : 'FAIL');
page.close();
process.exit(pass ? 0 : 1);
