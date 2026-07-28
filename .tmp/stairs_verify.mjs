// 石階換皮驗證：從石段中段往上看（斜欄＋親柱＋鳥居）
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

// 石段中段往山上看（大鳥居與社殿在頂端）——避開 z=-150 的傳送點
await shot(0, -138, Math.PI, 'stair_up.png');
// 石段頂端往下看（斜欄沿坡而下）
await shot(0, -92, 0, 'stair_down.png');
// 側面看斜欄的坡度
await shot(9, -115, Math.PI * 0.5, 'stair_side.png');

page.close();
process.exit(0);
