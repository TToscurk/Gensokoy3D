// 修復後驗證：同機位拍一張，再拍一張夜間確認霧盤跟著變暗
import { cdp } from './cdp.mjs';
import os from 'os';
const page = await cdp();
const wait = ms => new Promise(r => setTimeout(r, ms));

await page.send('Network.enable');
await page.send('Network.setCacheDisabled', { cacheDisabled: true });
await page.send('Page.reload', { ignoreCache: true });
await wait(3000);
for (let i = 0; i < 60; i++) {
  if (await page.evaljs(`!!document.querySelector('.card')`)) break;
  await wait(500);
}
await page.evaljs(`document.querySelector('.card').click(); undefined`);
for (let i = 0; i < 90; i++) {
  if (await page.evaljs(`!!(window.__gensokyo && __gensokyo.player)`)) break;
  await wait(500);
}
await wait(2000);

await page.evaljs(`(()=>{
  const g = window.__gensokyo;
  g.sky.time = 760; g.sky.speed = 0;
  g.player.teleport(195, 0);
})(); undefined`);
await wait(1500);
await page.evaljs(`(()=>{ window.__gensokyo.camYaw = -Math.PI/2; })(); undefined`);
await wait(600);
await page.shot(`${os.tmpdir()}/edge_fixed_day.png`);

// 夜間
await page.evaljs(`(()=>{ window.__gensokyo.sky.time = 1320; })(); undefined`);
await wait(800);
await page.shot(`${os.tmpdir()}/edge_fixed_night.png`);

page.close();
process.exit(0);
