// 探針：tenguVillage 出生點 vs 文的位置、瀑布/河床在哪、索道下山後的銜接
import { cdp } from './cdp.mjs';
const { evaljs } = await cdp();

const r = await evaljs(`(async () => {
  const g = window.__gensokyo;
  await g.manager.load('tenguVillage', null, { style: 'walk' });
  await new Promise(r => setTimeout(r, 800));
  const map = g.manager.map;
  const aya = g.npcs.npcs.find(n => n.spec.id === 'aya');
  const ayaPos = aya ? { x: +aya.root.position.x.toFixed(1), y: +aya.root.position.y.toFixed(1), z: +aya.root.position.z.toFixed(1) } : null;
  // 掃一條南北線的高度，找河床（突然下凹＝溪谷）
  const scan = [];
  for (let z = -60; z <= 80; z += 10) {
    scan.push([z, +map.heightAt(0, z).toFixed(1), +map.heightAt(10, z).toFixed(1)]);
  }
  const spawnH = +map.heightAt(0, 40).toFixed(1);
  const ayaH = ayaPos ? +map.heightAt(ayaPos.x, ayaPos.z).toFixed(1) : null;
  return JSON.stringify({ ayaPos, ayaH, spawnH, scan });
})()`, true).then(JSON.parse);
console.log('文的位置:', r.ayaPos, '腳下高度:', r.ayaH);
console.log('出生點 (0,40) 高度:', r.spawnH);
console.log('南北線高度掃描 [z, x=0, x=10]:');
for (const s of r.scan) console.log(' ', JSON.stringify(s));

// 索道下山後：山麓站 → 北側埡口 portal 是否會觸發到 lake
const r2 = await evaljs(`(async () => {
  const g = window.__gensokyo;
  await g.manager.load('youkaiMountain', 'from_moriya', { style: 'vehicle' });
  await new Promise(r => setTimeout(r, 600));
  const p0 = { x: +g.player.pos.x.toFixed(1), z: +g.player.pos.z.toFixed(1) };
  g.player.teleport(22, -104);
  await new Promise(r => setTimeout(r, 3000));
  return JSON.stringify({ 落點: p0, 走到埡口後: { map: g.manager.id, x: +g.player.pos.x.toFixed(1), z: +g.player.pos.z.toFixed(1) } });
})()`, true).then(JSON.parse);
console.log('索道下山銜接:', JSON.stringify(r2));

await evaljs(`(async () => { await window.__gensokyo.manager.load('legacy_open', null, {style:'walk'}); return 1; })()`, true);
process.exit(0);
