// 驗證：開機直接進 shrine（分圖），legacy_open 備援仍可進
import { cdp } from './cdp.mjs';
const page = await cdp();
const { evaljs, send } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ck = (n, ok, info='') => { ok ? pass++ : fail++; console.log(`${ok?'PASS':'FAIL'}  ${n}${info?'  '+info:''}`); };

await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.reload', { ignoreCache: true });
let booted = false;
for (let i = 0; i < 60; i++) {
  await wait(1000);
  booted = await evaljs(`document.getElementById('tip')?.textContent.includes('結界已開')`);
  if (booted) break;
}
ck('開機完成', booted);
await evaljs(`document.querySelector('.card').click(); undefined`);
await wait(3000);

const r1 = await evaljs(`(() => {
  const g = window.__gensokyo;
  const st = g.rootScene.getObjectByName('structures');
  return JSON.stringify({
    map: g.manager.id, x: +g.player.pos.x.toFixed(1), z: +g.player.pos.z.toFixed(1),
    y: +g.player.pos.y.toFixed(1), structuresVisible: !!st?.visible,
    running: g.state.running,
  });
})()`).then(JSON.parse);
ck('開機落在 shrine', r1.map === 'shrine', JSON.stringify(r1));
ck('出生點是神社 spawn (0,60)', Math.abs(r1.x) < 3 && Math.abs(r1.z - 60) < 3, `(${r1.x},${r1.z})`);
ck('舊世界建築群藏起來了', r1.structuresVisible === false);
ck('遊戲有在跑', r1.running === true);

// 備援：進 legacy_open 建築要回來
const r2 = await evaljs(`(async () => {
  const g = window.__gensokyo;
  await g.manager.load('legacy_open', null, { style: 'walk' });
  await new Promise(r => setTimeout(r, 800));
  const st = g.rootScene.getObjectByName('structures');
  return JSON.stringify({ map: g.manager.id, structuresVisible: !!st?.visible,
    draws: g.renderer.info.render.calls, errs: (window.__e || []).length });
})()`, true).then(JSON.parse);
ck('備援 legacy_open 可進且建築回來', r2.map === 'legacy_open' && r2.structuresVisible === true, JSON.stringify(r2));
ck('無 runtime 錯誤', r2.errs === 0);

console.log(`---- ${pass} PASS / ${fail} FAIL ----`);
process.exit(fail ? 1 : 0);
