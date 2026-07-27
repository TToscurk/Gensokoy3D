// 疾走架式外觀（居合走り）
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
await evaljs(`(() => { for (const c of document.querySelectorAll('.card'))
  if (c.textContent.includes('緣一')) { c.click(); return 1; } })()`);
await wait(3500);
await evaljs(`(() => {
  const g = window.__gensokyo, p = g.player;
  p.teleport(-8, 14);
  p.camYaw = 2.1; p.camPitch = 0.12; p.camDist = 7.5; p.camDistTarget = 7.5;
  g.sky.time = 900; g.sky.speed = 0;
  return 1;
})()`);
await wait(1400);
// 邊跑邊拍：用 hitstop 慢動作把腳步定格在中段
await evaljs(`(() => {
  const p = window.__gensokyo.player;
  p.keys['KeyW'] = true; p.keys['ShiftLeft'] = true; return 1;
})()`);
await wait(900);
await evaljs(`(() => { window.__gensokyo.combat.hitstop = 20; return 1; })()`);
await wait(700);
await shot(TMP + '/run_1_iai.png');
const st = await evaljs(`(() => { const g = window.__gensokyo;
  return g.player.speedH.toFixed(1) + ' m/s'; })()`);
console.log('拍了 run_1_iai.png，速度', st);
await evaljs(`(() => { const g = window.__gensokyo, p = g.player;
  g.combat.hitstop = 0; p.keys['KeyW'] = false; p.keys['ShiftLeft'] = false; return 1; })()`);
page.close(); process.exit(0);
