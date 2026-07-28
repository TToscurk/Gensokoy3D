// 落點健檢：每張圖的每個 entry —— 貼地、不在水裡、週圍 8m 內無瀑布級陡坡
import { cdp } from './cdp.mjs';
const { evaljs } = await cdp();
const wait = ms => new Promise(r => setTimeout(r, ms));

const ids = ['shrine','sando','village','forest','lake','sdm','bamboo','myouren','kourindou','muenzuka','sunflower','namelessHill','youkaiMountain','tenguVillage','moriya','netherworld','tenkai','higan'];
const problems = [];
for (const id of ids) {
  const r = await evaljs(`(async () => {
    const g = window.__gensokyo;
    await g.manager.load('${id}', null, { style: 'walk' });
    await new Promise(r => setTimeout(r, 500));
    const mod = g.manager.mod, map = g.manager.map;
    const out = [];
    const spots = [];
    for (const [name, e] of Object.entries(mod.entries || {})) spots.push(['entry:' + name, e.x, e.z]);
    for (const p of mod.portals || []) spots.push(['trigger:' + p.id, p.trigger.x, p.trigger.z]);
    for (const [name, x, z] of spots) {
      const h = map.heightAt(x, z);
      // 8 方位坡度掃描：相鄰 2m 高差 > 3m 視為崖/瀑布壁
      let maxDrop = 0;
      for (let a = 0; a < 8; a++) {
        const dx = Math.cos(a * Math.PI / 4) * 2, dz = Math.sin(a * Math.PI / 4) * 2;
        maxDrop = Math.max(maxDrop, Math.abs(map.heightAt(x + dx, z + dz) - h));
      }
      out.push({ name, x, z, h: +h.toFixed(1), maxDrop: +maxDrop.toFixed(1) });
    }
    return JSON.stringify(out);
  })()`, true).then(JSON.parse);
  for (const s of r) {
    const flag = s.maxDrop > 3 ? '  ⚠ 陡坡' : '';
    if (flag) problems.push(`${id} ${s.name} (${s.x},${s.z}) h=${s.h} 落差=${s.maxDrop}`);
    console.log(`${id}  ${s.name}  (${s.x},${s.z})  h=${s.h}  2m內最大落差=${s.maxDrop}${flag}`);
  }
  await wait(300);
}
console.log('----');
console.log(problems.length ? '問題點：\n' + problems.join('\n') : '全部落點平坦');
await evaljs(`(async () => { await window.__gensokyo.manager.load('shrine', null, {style:'walk'}); return 1; })()`, true);
process.exit(0);
