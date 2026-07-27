// gate 過場端到端：shrine 西坡之門 → 白玉樓，驗落點、花瓣錨點、回程
import { cdp } from './cdp.mjs';
const { evaljs } = await cdp();
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ck = (n, ok, info='') => { ok ? pass++ : fail++; console.log(`${ok?'PASS':'FAIL'}  ${n}${info?'  '+info:''}`); };

// 進 shrine 圖
await evaljs(`(async () => { await window.__gensokyo.manager.load('shrine', null, {style:'walk'}); return 1; })()`, true);
await wait(1500);

// 把玩家放到 gate 觸發圓心
const r1 = await evaljs(`(async () => {
  const g = window.__gensokyo;
  g.player.teleport(-150, 40);
  await new Promise(r => setTimeout(r, 3500));
  const petals = g.rootScene.getObjectByName('petals');
  return JSON.stringify({
    map: g.manager.id, x: +g.player.pos.x.toFixed(1), z: +g.player.pos.z.toFixed(1),
    y: +g.player.pos.y.toFixed(1),
    petalsVisible: !!petals?.visible,
    petalsOffset: petals ? [+petals.position.x.toFixed(0), +petals.position.z.toFixed(0)] : null,
  });
})()`, true).then(JSON.parse);
ck('走進西坡之門切到 netherworld', r1.map === 'netherworld', JSON.stringify(r1));
ck('落點是 from_shrine (0,90)', Math.abs(r1.x) < 3 && Math.abs(r1.z - 90) < 3, `(${r1.x},${r1.z})`);
ck('落點貼地', Math.abs(r1.y - 164.5) < 2, 'y=' + r1.y);
ck('櫻花吹雪在白玉樓看得見', r1.petalsVisible === true);
ck('花瓣錨點已平移成圖局部座標', r1.petalsOffset && r1.petalsOffset[0] === -620 && r1.petalsOffset[1] === 760, JSON.stringify(r1.petalsOffset));

// 回程：走到長階梯底端的門
const r2 = await evaljs(`(async () => {
  const g = window.__gensokyo;
  g.player.teleport(0, 112);
  await new Promise(r => setTimeout(r, 3500));
  const petals = g.rootScene.getObjectByName('petals');
  return JSON.stringify({
    map: g.manager.id, x: +g.player.pos.x.toFixed(1), z: +g.player.pos.z.toFixed(1),
    petalsVisible: !!petals?.visible,
  });
})()`, true).then(JSON.parse);
ck('長階梯底端之門回到 shrine', r2.map === 'shrine', JSON.stringify(r2));
ck('落點是 from_netherworld (-126,34)', Math.abs(r2.x + 126) < 3 && Math.abs(r2.z - 34) < 3, `(${r2.x},${r2.z})`);
ck('離開白玉樓後花瓣收起來', r2.petalsVisible === false);

// 回 legacy_open 還原
await evaljs(`(async () => { await window.__gensokyo.manager.load('legacy_open', null, {style:'walk'}); return 1; })()`, true);
await wait(1000);
console.log(`---- ${pass} PASS / ${fail} FAIL ----`);
process.exit(fail ? 1 : 0);
