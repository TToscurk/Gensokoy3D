import { cdp } from './cdp.mjs';
const page = await cdp();
const { evaljs, send } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));

await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.reload', { ignoreCache: true });
await wait(1500);

const r = await evaljs(`(async () => {
  const shrine = await import('./src/scene/maps/shrine.js');
  const village = await import('./src/scene/maps/village.js');
  const terrain = await import('./src/world/terrain.js');
  const shrineH = shrine.heightAt(0, -150); // shrine_to_sando trigger
  const villageWorld = terrain.terrainHeight(village.ORIGIN.x + 0, village.ORIGIN.z - 190); // village entry from_sando local(0,-190)
  const villageEntryHeightAt = shrine; // n/a
  return JSON.stringify({ shrineH, villageWorld, villageOrigin: village.ORIGIN });
})()`, true);
console.log(r);
