// 拜殿移植驗證：正面 / 近景 / 內部 三機位
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
})(); undefined`);

const shot = async (x, z, yaw, name, extraWait = 900) => {
  await page.evaljs(`(()=>{
    const g = window.__gensokyo;
    g.player.teleport(${x}, ${z});
    g.camYaw = ${yaw};
  })(); undefined`);
  await wait(extraWait);
  await page.shot(`${os.tmpdir()}/${name}`);
};

// 正面全景（站在參道上看社殿，偏一點不擋畫面）
await shot(5.5, -2, Math.PI, 'haiden_front.png');
// 走近看屋頂與欄杆
await shot(3.2, 6.5, Math.PI, 'haiden_close.png');
// 遠景剪影（從參道看中鳥居與大屋根）
await shot(8, -14, Math.PI, 'haiden_far.png');
// 殿內抬頭（看天花板與露明樑）——pitch 用 debug hook 試試
await shot(0.8, 14.5, Math.PI, 'haiden_ceiling.png');
await page.evaljs(`(()=>{ const g=window.__gensokyo; if('camPitch' in g) g.camPitch = 0.9; })(); undefined`);
await wait(400);
await page.shot(`${os.tmpdir()}/haiden_ceiling2.png`);

page.close();
process.exit(0);
