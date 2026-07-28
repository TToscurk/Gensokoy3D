// 探查：霧盤狀態 + 黑點真身（輪流關 grass / floor / skirt）
import { cdp } from './cdp.mjs';
import os from 'os';
const page = await cdp();
const wait = ms => new Promise(r => setTimeout(r, ms));

for (let i = 0; i < 60; i++) {
  if (await page.evaljs(`!!(window.__gensokyo && __gensokyo.player)`)) break;
  await wait(500);
}
await page.evaljs(`(()=>{
  const g = window.__gensokyo;
  g.sky.time = 760; g.sky.speed = 0;
  g.player.teleport(195, 0);
  g.camYaw = -Math.PI/2;
})(); undefined`);
await wait(1200);

const info = await page.evaljs(`(()=>{
  const g = window.__gensokyo;
  let floor=null, skirt=null, grass=null;
  g.rootScene.traverse(o=>{
    if(o.name==='terrain-haze-floor') floor=o;
    if(o.name==='terrain-skirt') skirt=o;
  });
  grass = g.manager.map?.grass?.mesh || null;
  const m = g.manager.map;
  return JSON.stringify({
    floor: floor ? { y: floor.position.y, r: floor.geometry.parameters.radius,
      col: floor.material.color.getHexString(), visible: floor.visible,
      inScene: (()=>{let p=floor; while(p.parent) p=p.parent; return p===g.rootScene || p.type==='Scene';})() } : null,
    skirtGroupChildren: skirt ? skirt.parent.children.map(c=>c.name||c.type) : null,
    grassMesh: grass ? { count: grass.count, visible: grass.visible } : null,
    heightSpace: g.manager.mod?.meta?.heightSpace,
    size: g.manager.mod?.meta?.size,
  });
})()`);
console.log(info);

// 關草
await page.evaljs(`(()=>{ const m=window.__gensokyo.manager.map; if(m?.grass) m.grass.mesh.visible=false; })(); undefined`);
await wait(300);
await page.shot(`${os.tmpdir()}/probe_nograss.png`);
await page.evaljs(`(()=>{ const m=window.__gensokyo.manager.map; if(m?.grass) m.grass.mesh.visible=true; })(); undefined`);

// 關霧盤
await page.evaljs(`(()=>{ window.__gensokyo.rootScene.traverse(o=>{if(o.name==='terrain-haze-floor')o.visible=false;}); })(); undefined`);
await wait(300);
await page.shot(`${os.tmpdir()}/probe_nofloor.png`);

page.close();
process.exit(0);
