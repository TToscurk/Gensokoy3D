// 火星／火龍外觀。一樣借 hitstop 把遊戲降到 12% 速度，才拍得到尖峰那一格。
import { cdp } from './cdp.mjs';

const TMP = (await import('os')).tmpdir();   // 原本寫死作者機器的路徑
const page = await cdp();
const { send, evaljs, shot } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));

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
  const g = window.__gensokyo, p = g.player;
  const m = g.mobs.mobs.find(m => m.state !== 2);
  p.teleport(m.pos.x + 3.5, m.pos.z + 3.5);
  p.camYaw = Math.atan2(-(m.pos.x - p.pos.x), -(m.pos.z - p.pos.z));
  p.camPitch = 0.34; p.camDist = 9; p.camDistTarget = 9;
  g.sky.time = 1180; g.sky.speed = 0;      // 黃昏：火光最好看
  if (!g.combat.drawn) g.combat.toggleSheath();
  return 1;
})()`);
await wait(1500);

const SLOW = 0.12;
// [型號, 出招後幾秒（遊戲時間）, 檔名]
const shots = [
  [2, 0.19, 'fx_1_sparks.png'],     // 參之型：刀尖火星
  [10, 0.24, 'fx_2_dragon.png'],    // 拾壹之型：日暈之龍剛竄出去
  [12, 0.34, 'fx_3_rinne.png'],     // 拾參之型：終結技的大龍
];

for (const [idx, secs, file] of shots) {
  await evaljs(`(() => { const c = window.__gensokyo.combat;
    c.formIndex = ${idx}; c.animT = -1; c.tryAttack(); c.hitstop = 20; return 1; })()`);
  await wait((secs / SLOW) * 1000);
  await shot(TMP + '/' + file);
  const st = await evaljs(`(() => { const f = window.__gensokyo.slashFX;
    return f.embers.n + '顆火星 / 龍:' + f.dragon.on; })()`);
  console.log('拍了', file, st);
  await evaljs(`(() => { window.__gensokyo.combat.hitstop = 0; return 1; })()`);
  await wait(2200);
}

page.close();
process.exit(0);
