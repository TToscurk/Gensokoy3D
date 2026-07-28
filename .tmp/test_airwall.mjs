// 空氣牆驗收：走不出圖、但所有出入口仍搆得到
import { cdp } from './cdp.mjs';
const page = await cdp();
const { evaljs, send } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ck = (n, ok, info='') => { ok ? pass++ : fail++; console.log(`${ok?'PASS':'FAIL'}  ${n}${info?'  '+info:''}`); };

await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 60; i++) { if (await evaljs(`document.getElementById('tip')?.textContent.includes('結界已開')`)) break; await wait(1000); }
await evaljs(`document.querySelector('.card').click(); undefined`);
await wait(3000);

// ① 每張圖：往四個方向硬推，看會不會被擋住
const ids = await evaljs(`(async () => (await import('./src/scene/registry.js')).MAP_IDS)()`, true);
const leaks = [];
for (const id of ids) {
  if (id === 'legacy_open') continue;
  await evaljs(`window.__gensokyo.manager.load('${id}', null, { style: 'boot' })`, true);
  await wait(900);
  const r = await evaljs(`(() => {
    const MAPID = '${id}';
    const g = window.__gensokyo, p = g.player, m = g.manager.meta;
    const hx = (m.sizeX ?? m.size)/2, hz = (m.sizeZ ?? m.size)/2;
    const out = [];
    for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      // 直接把座標塞到圖外，再跑一幀讓 clamp 生效
      p.pos.set(dx * (hx + 400), p.pos.y, dz * (hz + 400));
      p.update(0.05, 0);
      if (Math.abs(p.pos.x) > hx + 0.5 || Math.abs(p.pos.z) > hz + 0.5)
        out.push('(' + dx + ',' + dz + ')→(' + p.pos.x.toFixed(0) + ',' + p.pos.z.toFixed(0) + ')');
    }
    return JSON.stringify({ id: MAPID, hx: hx, hz: hz, 漏: out });
  })()`).then(JSON.parse);
  if (r.漏.length) leaks.push(r);
}
ck('18 張圖都推不出邊界', leaks.length === 0,
   leaks.length ? JSON.stringify(leaks) : '全部被擋住');

// ② 牆不能擋住出入口：實走一趟最貼邊的那條（sando → shrine，觸發區 z=-292、圖半邊 300）
await evaljs(`window.__gensokyo.manager.load('sando', null, { style: 'boot' })`, true);
await wait(1500);
await evaljs(`(() => { const p = window.__gensokyo.manager.map.portals.find(p=>p.to==='shrine');
  window.__gensokyo.player.teleport(p.trigger.x, p.trigger.z); return 1; })()`);
await wait(3000);
ck('最貼邊的出入口仍搆得到（sando→shrine）',
   await evaljs(`window.__gensokyo.mapId`) === 'shrine',
   `現在在 ${await evaljs(`window.__gensokyo.mapId`)}`);

// ③ 飛行也受限
await evaljs(`window.__gensokyo.manager.load('shrine', null, { style: 'boot' })`, true);
await wait(1200);
const fly = await evaljs(`(() => {
  const g = window.__gensokyo, p = g.player;
  p.flying = true;
  p.pos.set(5000, 200, 5000);
  p.update(0.05, 0);
  const m = g.manager.meta, hx = m.size/2;
  return JSON.stringify({ x: +p.pos.x.toFixed(0), z: +p.pos.z.toFixed(0), 界: hx });
})()`).then(JSON.parse);
ck('飛行同樣被夾住', Math.abs(fly.x) <= fly.界 && Math.abs(fly.z) <= fly.界, JSON.stringify(fly));

console.log(`\n---- ${pass} PASS / ${fail} FAIL ----`);
page.close(); process.exit(fail ? 1 : 0);
