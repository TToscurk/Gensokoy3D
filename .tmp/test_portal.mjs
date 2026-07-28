// 出入口驗收（SCENE_MANAGER_SPEC §6）：
//   ① 連線圖完整（雙向、目標地圖存在、entry 存在）
//   ② 走進觸發圓柱會切圖，且落點是目標圖的指定 entry
//   ③ 落點不會立刻踩到回程的觸發區（來回彈跳）
//   ④ 戰鬥中不觸發
//   ⑤ 切圖後玩家速度歸零（不帶著慣性進新圖）
//   ⑥ 每張圖 draw call < 200
import { cdp } from './cdp.mjs';

const page = await cdp();
const { send, evaljs } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (n, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? '  ' + info : ''}`); };

await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 60; i++) {
  if (await evaljs(`document.getElementById('tip')?.textContent.includes('結界已開')`)) break;
  await wait(1000);
}
await evaljs(`document.querySelector('.card').click(); undefined`);
await wait(3000);
await evaljs(`(() => { window.__e = []; window.addEventListener('error', e => window.__e.push(String(e.message))); return 1; })()`);

// --- ① 連線圖完整性 -------------------------------------------------------
const graph = await evaljs(`(async () => {
  const reg = await import('./src/scene/registry.js');
  const { errors, warnings } = await reg.validateGraph();
  const table = await reg.linkTable();
  return JSON.stringify({ errs: errors, warns: warnings, table, ids: reg.MAP_IDS });
})()`, true).then(JSON.parse);
ck('連線圖零錯誤（雙向、目標存在、entry 存在、落點不在觸發區內）',
   graph.errs.length === 0,
   graph.errs.length ? graph.errs.join(' / ') : `${Object.keys(graph.table).length} 張圖`);
if (graph.warns.length) {
  console.log(`      （${graph.warns.length} 則餘裕不足的警告，不算失敗）`);
  for (const w of graph.warns) console.log('        · ' + w);
}
ck('shrine 與 sando 都註冊了', graph.ids.includes('shrine') && graph.ids.includes('sando'),
   graph.ids.join(','));

// --- ② 走進觸發區會切圖，落點正確 ----------------------------------------
const gotoMap = async (id, entry = null) => {
  await evaljs(`window.__gensokyo.manager.load('${id}', ${entry ? `'${entry}'` : 'null'}, { style: 'walk' })`, true);
  await wait(2200);
};

await gotoMap('shrine');
ck('載入 shrine', await evaljs(`window.__gensokyo.mapId`) === 'shrine');

// 把玩家挪到「往參道」的觸發圓柱裡，讓主迴圈自己偵測
const trig = await evaljs(`(() => {
  const p = window.__gensokyo.manager.map.portals[0];
  return JSON.stringify(p.trigger);
})()`).then(JSON.parse);
await evaljs(`window.__gensokyo.player.teleport(${trig.x}, ${trig.z}); undefined`);
await wait(3000);

const arrived = await evaljs(`(() => {
  const g = window.__gensokyo, p = g.player.pos;
  return JSON.stringify({
    mapId: g.mapId, entry: g.manager.entry,
    pos: { x: +p.x.toFixed(1), z: +p.z.toFixed(1), y: +p.y.toFixed(1) },
    ground: +g.manager.heightAt(p.x, p.z).toFixed(1),
    speed: +Math.hypot(g.player.vel.x, g.player.vel.y, g.player.vel.z).toFixed(3),
  });
})()`).then(JSON.parse);
ck('踏進觸發區自動切到 sando', arrived.mapId === 'sando', JSON.stringify(arrived));

const wantEntry = await evaljs(`(async () => {
  const m = await import('./src/scene/maps/sando.js');
  return JSON.stringify(m.entries.from_shrine);
})()`, true).then(JSON.parse);
ck('落在目標圖的指定 entry',
   Math.abs(arrived.pos.x - wantEntry.x) < 1.5 && Math.abs(arrived.pos.z - wantEntry.z) < 1.5,
   `落點 (${arrived.pos.x}, ${arrived.pos.z}) vs entry (${wantEntry.x}, ${wantEntry.z})`);
ck('落點站在地面上（沒有埋進地形或浮空）',
   Math.abs(arrived.pos.y - arrived.ground) < 2.0,
   `y=${arrived.pos.y} 地面=${arrived.ground}`);

// --- ⑤ 切圖後速度歸零 -----------------------------------------------------
ck('切圖後玩家速度歸零', arrived.speed < 3.0, `|v| = ${arrived.speed}`);

// --- ③ 落點不會立刻彈回去 -------------------------------------------------
await wait(2500);
ck('落點不在回程觸發區內（不會來回彈跳）',
   await evaljs(`window.__gensokyo.mapId`) === 'sando',
   `2.5 秒後仍在 ${await evaljs(`window.__gensokyo.mapId`)}`);

// --- ④ 戰鬥中不觸發 -------------------------------------------------------
await gotoMap('shrine');
const combatBlocked = await evaljs(`(() => {
  const g = window.__gensokyo;
  const p = g.manager.map.portals[0].trigger;
  // 假裝正在出招
  if (g.combat) g.combat.busy = true;
  return JSON.stringify({
    有戰鬥控制器: !!g.combat,
    觸發中: !!g.manager.portalAt(p.x, p.z, { inCombat: true }),
    非戰鬥時觸發: !!g.manager.portalAt(p.x, p.z, { inCombat: false }),
  });
})()`).then(JSON.parse);
ck('戰鬥中不觸發出入口', combatBlocked.觸發中 === false, JSON.stringify(combatBlocked));
ck('非戰鬥時同一點會觸發（證明測的是同一個點）', combatBlocked.非戰鬥時觸發 === true);
await evaljs(`(() => { if (window.__gensokyo.combat) window.__gensokyo.combat.busy = false; })()`);

// --- ⑥ 每張圖 draw call ---------------------------------------------------
const draws = {};
for (const id of ['shrine', 'sando', 'legacy_open']) {
  await gotoMap(id);
  await wait(1200);
  draws[id] = await evaljs(`window.__gensokyo.renderer.info.render.calls`);
}
ck('shrine draw call < 200', draws.shrine < 200 && draws.shrine > 0, `${draws.shrine}`);
ck('sando draw call < 200', draws.sando < 200 && draws.sando > 0, `${draws.sando}`);
ck('回 legacy_open 建築與住民都回來了',
   draws.legacy_open > 60,
   `${draws.legacy_open} draws`);

const errs = await evaljs(`window.__e.length`);
ck('無 runtime 錯誤', errs === 0, `err=${errs}`);

console.log(`\n---- ${pass} PASS / ${fail} FAIL ----`);
page.close();
process.exit(fail ? 1 : 0);
