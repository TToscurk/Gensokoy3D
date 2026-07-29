import { cdp } from './cdp.mjs';
const OUT = '/tmp/claude-0/-home-user-Gensokoy3D/1da3161e-d6d2-56de-9f1c-70fa5c196eaf/scratchpad';
const { writeFileSync, mkdirSync } = await import('fs');
mkdirSync(OUT, { recursive: true });

const page = await cdp();
const { evaljs, send, shot } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));

await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 30; i++) { if (await evaljs(`document.getElementById('tip')?.textContent.includes('結界已開')`)) break; await wait(1000); }
await evaljs(`document.querySelector('.card').click(); undefined`);
await wait(2000);

await evaljs(`window.__gensokyo.manager.load('sando', null, { style: 'boot' })`, true);
await wait(2000);

async function shotAt(name, x, z, yaw, pitch, dist) {
  await evaljs(`(() => {
    const G = window.__gensokyo;
    if (G.sky) G.sky.time = 600;
    G.player.teleport(${x}, ${z});
    G.player.camYaw = ${yaw};
    G.player.camPitch = ${pitch};
    G.player.camDist = ${dist}; G.player.camDistTarget = ${dist};
    return 1;
  })()`);
  await wait(1800);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/sando_${name}.png`, Buffer.from(s.data, 'base64'));
  console.log('saved', name);
}

// ① 神社端入口，往下望向彎道
await shotAt('entry_shrine', 0, -255, 0, -0.15, 14);
// ② 彎道中段（S 彎頂點附近）
await shotAt('bend_mid', 0, 0, Math.PI * 0.5, -0.1, 16);
// ③ 里端入口，往上望
await shotAt('entry_village', 0, 255, Math.PI, -0.15, 14);
// ④ 邊界：站在靠近彎道頂點的邊緣，往外看（檢查破口）
await shotAt('edge_bend_outward', 0, 0, Math.PI * 0.5, 0.05, 6);
// ⑤ 邊界：站在圖角落附近，往外看
await shotAt('edge_corner_outward', 80, 260, Math.PI * 0.75, 0.05, 6);
// ⑥ 空拍俯瞰整體 S 彎構圖
await shotAt('overview', 0, 0, Math.PI * 0.5, -0.85, 220);

const info = await evaljs(`(() => {
  const G = window.__gensokyo;
  return JSON.stringify({ mapId: G.mapId, drawCalls: G.renderer?.info?.render?.calls });
})()`);
console.log('info:', info);

page.close();
process.exit(0);
