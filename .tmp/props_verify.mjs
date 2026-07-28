// 小件移植驗證：狛犬 / 手水舍 / 繪馬掛 / 玉垣
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

await page.evaljs(`(()=>{ const g = window.__gensokyo; g.sky.time = 760; g.sky.speed = 0; })(); undefined`);

const shot = async (x, z, yaw, name) => {
  await page.evaljs(`(()=>{
    const g = window.__gensokyo;
    g.player.teleport(${x}, ${z});
    g.camYaw = ${yaw};
  })(); undefined`);
  await wait(900);
  await page.shot(`${os.tmpdir()}/${name}`);
};

// 狛犬一對（站在賽錢箱前往社殿方向看，兩隻都入鏡）
await shot(0, 3.5, Math.PI, 'prop_komainu.png');
// 手水舍（從參道側看亭與石鉢）
await shot(6.4, -9.5, Math.PI, 'prop_chozuya.png');
// 繪馬掛（從參道看）
await shot(-5.2, -6.5, Math.PI - 0.5, 'prop_ema.png');
// 玉垣（沿著東側圍籬看）
await shot(17.5, -8, Math.PI * 0.75, 'prop_tamagaki.png');
// 全景確認佈局
await shot(0, -26, Math.PI, 'prop_overview.png');

page.close();
process.exit(0);
