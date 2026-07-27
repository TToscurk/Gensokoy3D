// 刀光外觀：出招後在斬擊尖峰的那一格截圖（不重載，沿用現場）
import { cdp } from './cdp.mjs';

const TMP = (await import('os')).tmpdir();   // 原本寫死作者機器的路徑
const page = await cdp();
const { evaljs, shot } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));

// 一定要自己重載選緣一 —— test_trail 收尾停在靈夢（無刀 fallback）身上
await page.send('Network.enable');
await page.send('Network.setCacheDisabled', { cacheDisabled: true });
await page.send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 60; i++) {
  if (await evaljs(`document.getElementById('tip')?.textContent.includes('結界已開')`)) break;
  await wait(1000);
}
await evaljs(`(() => {
  for (const c of document.querySelectorAll('.card')) if (c.textContent.includes('緣一')) { c.click(); return 1; }
})()`);
await wait(3000);
await evaljs(`(() => {
  const g = window.__gensokyo;
  const m = g.mobs.mobs.find(m => m.state !== 2);
  g.player.teleport(m.pos.x + 3.0, m.pos.z + 3.0);
  g.player.camYaw = Math.atan2(-(m.pos.x - g.player.pos.x), -(m.pos.z - g.player.pos.z));
  return 1;
})()`);

await evaljs(`(() => {
  const g = window.__gensokyo, p = g.player;
  p.camPitch = 0.42;                 // 俯角才看得出刀光的形狀
  p.camDist = 6.8; p.camDistTarget = 6.8;
  g.sky.time = 780; g.sky.speed = 0;
  if (!g.combat.drawn) g.combat.toggleSheath();
  return 1;
})()`);
await wait(1200);

// 刀光只活 0.22 秒（遊戲時間），CDP 一個來回就過期了。
// 借用現成的 hitstop 機制把遊戲降到 12% 速度，就有充裕時間拍到尖峰那一格。
const SLOW = 0.12;

// [型號, 想拍的動作進度 k, 檔名]
const shots = [
  [1, 0.50, 'trail_1_skyrend.png'],   // 貳之型・碧羅之天（垂直劈落）
  [0, 0.62, 'trail_2_waltz.png'],     // 壹之型・圓舞（繞身一圈）
  [6, 0.45, 'trail_3_pierce.png'],    // 柒之型・陽華突（直刺）
  [12, 0.84, 'trail_4_rinne.png'],    // 拾參之型・輪廻（雙圈終結）
];

for (const [idx, k, file] of shots) {
  const dur = await evaljs(`(async () => (await import('/src/combat/forms.js')).FORMS[${idx}].dur)()`, true);
  await evaljs(`(() => { const c = window.__gensokyo.combat;
    c.formIndex = ${idx}; c.animT = -1; c.tryAttack(); c.hitstop = 9; return 1; })()`);
  await wait((k * dur / SLOW) * 1000);
  await shot(TMP + '/' + file);
  const live = await evaljs(`window.__gensokyo.slashFX._trail.buf.filter(s => s.age < 0.30).length`);
  console.log('拍了', file, `（刀光取樣點 ${live}）`);
  await evaljs(`(() => { const c = window.__gensokyo.combat; c.hitstop = 0; return 1; })()`);
  await wait(1200);                   // 等刀光散掉再拍下一張
}

page.close();
process.exit(0);
