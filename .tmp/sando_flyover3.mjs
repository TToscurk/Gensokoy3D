import { cdp } from './cdp.mjs';
const OUT = '/tmp/claude-0/-home-user-Gensokoy3D/1da3161e-d6d2-56de-9f1c-70fa5c196eaf/scratchpad';
const { writeFileSync } = await import('fs');
const page = await cdp();
const { evaljs, send } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));

await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 30; i++) { if (await evaljs(`document.getElementById('tip')?.textContent.includes('結界已開')`)) break; await wait(1000); }
await evaljs(`document.querySelector('.card').click(); undefined`);
await wait(2000);
await evaljs(`window.__gensokyo.manager.load('sando', null, { style: 'boot' })`, true);
await wait(2500);

async function shotFly(name, x, y, z, yaw, pitch, dist) {
  await evaljs(`(() => {
    const G = window.__gensokyo;
    G.sky.time = 600;
    G.player.flying = true;
    G.player.pos.set(${x}, ${y}, ${z});
    G.player.camYaw = ${yaw};
    G.player.camPitch = ${pitch};
    G.player.camDist = ${dist}; G.player.camDistTarget = ${dist};
    return 1;
  })()`);
  await wait(1500);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/sando_${name}.png`, Buffer.from(s.data, 'base64'));
  console.log('saved', name, await evaljs(`JSON.stringify(window.__gensokyo.player.pos)`));
}

await shotFly('fly_bird2', 0, 90, -30, Math.PI * 0.5, -0.55, 45);
await shotFly('fly_south_look_north', 0, 60, 250, 0, -0.35, 45);

page.close();
process.exit(0);
