// 索道下山：山麓站 → 北側埡口 portal 是否觸發到 lake（帶除錯）
import { cdp } from './cdp.mjs';
const { evaljs } = await cdp();
const r = await evaljs(`(async () => {
  const g = window.__gensokyo;
  const ok = await g.manager.load('youkaiMountain', 'from_moriya', { style: 'vehicle' });
  await new Promise(r => setTimeout(r, 800));
  if (!g.player) return JSON.stringify({ fatal: 'player 未定義, load=' + ok, map: g.manager.id });
  const p0 = { x: +g.player.pos.x.toFixed(1), z: +g.player.pos.z.toFixed(1) };
  g.player.teleport(22, -104);
  await new Promise(r => setTimeout(r, 3000));
  return JSON.stringify({ 落點: p0, 走到埡口後: { map: g.manager.id, x: +g.player.pos.x.toFixed(1), z: +g.player.pos.z.toFixed(1) } });
})()`, true);
console.log('索道下山銜接:', r);
await evaljs(`(async () => { await window.__gensokyo.manager.load('legacy_open', null, {style:'walk'}); return 1; })()`, true);
process.exit(0);
