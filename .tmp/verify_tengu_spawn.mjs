// 驗證：天狗聚落新出生點應在文旁邊的台地上（高≈141），不在溪谷
import { cdp } from './cdp.mjs';
const page = await cdp();
const { evaljs } = page;
await page.send('Network.setCacheDisabled', { cacheDisabled: true });
await page.send('Page.reload', { ignoreCache: true });
let booted = false;
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 1000));
  booted = await evaljs(`document.getElementById('tip')?.textContent.includes('結界已開')`);
  if (booted) break;
}
if (!booted) { console.log('FATAL: 開機逾時'); process.exit(1); }
await evaljs(`document.querySelector('.card').click(); undefined`);
for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 1000));
  if (await evaljs(`typeof window.__gensokyo?.player`) !== 'undefined') break;
}
if (await evaljs(`typeof window.__gensokyo?.player`) === 'undefined') {
  console.log('FATAL: 選角後玩家沒出現'); process.exit(1);
}

const r = await evaljs(`(async () => {
  const g = window.__gensokyo;
  await g.manager.load('tenguVillage', null, { style: 'walk' });
  await new Promise(r => setTimeout(r, 1200));
  const aya = g.npcs.npcs.find(n => n.spec.id === 'aya');
  const p = g.player.pos;
  const dist = aya ? Math.hypot(aya.root.position.x - p.x, aya.root.position.z - p.z) : null;
  return JSON.stringify({
    x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1),
    ground: +g.manager.map.heightAt(p.x, p.z).toFixed(1),
    離文: dist ? +dist.toFixed(1) : null,
  });
})()`, true);
console.log('新出生點:', r);
await page.shot(`${process.env.TEMP}/tengu_spawn.png`).then(p => console.log('截圖:', p));
await evaljs(`(async () => { await window.__gensokyo.manager.load('legacy_open', null, {style:'walk'}); return 1; })()`, true);
process.exit(0);
