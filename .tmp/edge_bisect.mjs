// 白邊成因二分：依序關掉 skirt / vegetation / atmosphere 各拍一張
import { cdp } from './cdp.mjs';
import os from 'os';
const page = await cdp();
const wait = ms => new Promise(r => setTimeout(r, ms));

// 進遊戲（選第一張卡）
for (let i = 0; i < 60; i++) {
  if (await page.evaljs(`!!document.querySelector('.card')`)) break;
  await wait(500);
}
await page.evaljs(`document.querySelector('.card').click(); undefined`);
await page.evaljs(`window.__gensokyo && undefined`);
for (let i = 0; i < 60; i++) {
  if (await page.evaljs(`!!(window.__gensokyo && __gensokyo.player)`)) break;
  await wait(500);
}

await page.evaljs(`(()=>{
  const g = window.__gensokyo;
  g.sky.time = 760; g.sky.speed = 0;
  g.player.teleport(195, 0);
})(); undefined`);
await wait(1200);
await page.evaljs(`(()=>{ window.__gensokyo.camYaw = -Math.PI/2; })(); undefined`);
await wait(600);

const find = (name) => `(()=>{let f=null;window.__gensokyo.rootScene.traverse(o=>{if(o.name==='${name}')f=o;});return f;})()`;

// baseline（skirt 關）
await page.evaljs(`${find('terrain-skirt')}.visible=false; undefined`);
await wait(300);
await page.shot(`${os.tmpdir()}/edge_A_noskirt.png`);
await page.evaljs(`${find('terrain-skirt')}.visible=true; undefined`);

// vegetation 關
await page.evaljs(`${find('vegetation')} ? ${find('vegetation')}.visible=false : null; undefined`);
await page.evaljs(`${find('terrain-skirt')}.visible=false; undefined`);
await wait(300);
await page.shot(`${os.tmpdir()}/edge_B_noveg.png`);

// atmosphere 也關
await page.evaljs(`
  let atmo=null; window.__gensokyo.rootScene.traverse(o=>{if(o.name&&/atmo|cloud|mist/i.test(o.name))atmo=o;});
  if(atmo) atmo.visible=false;
  undefined`);
await wait(300);
await page.shot(`${os.tmpdir()}/edge_C_noveg_noatmo.png`);

// 復原
await page.evaljs(`
  ${find('terrain-skirt')}.visible=true;
  ${find('vegetation')} ? ${find('vegetation')}.visible=true : null;
  window.__gensokyo.rootScene.traverse(o=>{if(o.name&&/atmo|cloud|mist/i.test(o.name))o.visible=true;});
  undefined`);

// 順便列出 skirt 外有沒有 vegetation 子物件（數 instance 分布範圍）
const vegInfo = await page.evaljs(`(()=>{
  const g = window.__gensokyo;
  let veg=null; g.rootScene.traverse(o=>{if(o.name==='vegetation')veg=o;});
  if(!veg) return 'no veg';
  const out=[];
  veg.children.forEach(im=>{
    if(!im.isInstancedMesh) return;
    let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
    for(let i=0;i<im.count;i++){
      const a=im.instanceMatrix.array;
      const x=a[i*16+12], z=a[i*16+14];
      if(x<minX)minX=x; if(x>maxX)maxX=x;
      if(z<minZ)minZ=z; if(z>maxZ)maxZ=z;
    }
    out.push({n:im.count, minX:minX|0, maxX:maxX|0, minZ:minZ|0, maxZ:maxZ|0});
  });
  return JSON.stringify(out);
})()`);
console.log('veg extents (local):', vegInfo);
page.close();
process.exit(0);
