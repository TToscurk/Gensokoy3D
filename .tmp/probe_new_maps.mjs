// 批次驗證：每張新圖載入 → draw call / console 錯誤 / 各 entry 落點貼地檢查。
// 用法：node .tmp/probe_new_maps.mjs mapId [mapId...]
// 不重載頁面（沿用現場），收尾切回 legacy_open 免得污染後續測試。
import { cdp } from './cdp.mjs';

const page = await cdp();
const { evaljs } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));

const ids = process.argv.slice(2);
if (!ids.length) { console.error('用法：node probe_new_maps.mjs mapId...'); process.exit(1); }

let fails = 0;
for (const id of ids) {
  const r = await evaljs(`(async () => {
    const g = window.__gensokyo;
    const ok = await g.manager.load('${id}', null, { style: 'walk' });
    if (!ok) return { fatal: 'load 回傳 false' };
    await new Promise(r => setTimeout(r, 600));
    const mod = g.manager.mod, map = g.manager.map;
    const draws = g.renderer.info.render.calls;
    const tris = g.renderer.info.render.triangles;
    const entries = {};
    for (const [name, e] of Object.entries(mod.entries || {})) {
      if (name === 'default') continue;
      const gy = map.heightAt(e.x, e.z);
      entries[name] = (e.y === undefined) ? +gy.toFixed(1) : { y: e.y, ground: +gy.toFixed(1) };
    }
    return { draws, tris, npcs: (map.npcs || []).length, entries,
             runtimeErrs: (window.__e || []).length };
  })()`, true);
  if (r.fatal || r.runtimeErrs) {
    fails++;
    console.log('FAIL', id, r.fatal || ('runtime 錯誤 ' + r.runtimeErrs));
  } else {
    console.log('PASS', id, 'draws=' + r.draws, 'tris=' + Math.round(r.tris / 1000) + 'K',
      'npcs=' + r.npcs, JSON.stringify(r.entries));
  }
  await wait(400);
}
await evaljs(`window.__gensokyo.manager.load('legacy_open', null, { style: 'walk' })`, true);
await wait(1500);
console.log(fails ? `---- ${fails} FAIL ----` : '---- 全部 PASS ----');
process.exit(fails ? 1 : 0);
