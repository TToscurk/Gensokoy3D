// 截斬弧特寫：高視角看扇形月牙（用參之型・烈日紅鏡，110° 扇形最像劍氣）
import { cdp } from './cdp.mjs';

const TMP = (await import('os')).tmpdir();   // 原本寫死作者機器的路徑
const page = await cdp();
const { send, evaljs, shot } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));

// 不重載：沿用上一個測試的狀態（玩家已在妖精窩旁）
const ok = await evaljs(`!!window.__gensokyo?.state?.running`);
if (!ok) { console.log('遊戲沒在跑，請先跑 test_combat.mjs'); page.close(); process.exit(1); }

await evaljs(`(() => {
  const g = window.__gensokyo, p = g.player;
  const m = g.mobs.mobs.find(m => m.state !== 2 &&
    Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z) < 25) || g.mobs.mobs[0];
  // 站到妖精旁邊面向牠
  p.teleport(m.pos.x + 3.5, m.pos.z + 3.5);
  const dx = m.pos.x - p.pos.x, dz = m.pos.z - p.pos.z;
  p.camYaw = Math.atan2(-dx, -dz);
  p.camDist = 6.5; p.camDistTarget = 6.5;
  p.camPitch = 0.55;           // 拉高俯角才能看到扇形攤在地上
  return true;
})()`);
await wait(1600);  // 相機 lerp 落定

await evaljs(`(() => {
  const c = window.__gensokyo.combat;
  c.formIndex = 2;             // 參之型・烈日紅鏡
  c.animT = -1;
  c.tryAttack();
  return true;
})()`);
await wait(150);               // 斬弧長到最亮的瞬間
await shot(TMP + '/combat_crescent.png');
console.log('已截圖 combat_crescent.png');
page.close();
process.exit(0);
