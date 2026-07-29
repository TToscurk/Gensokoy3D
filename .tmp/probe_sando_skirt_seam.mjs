import { cdp } from './cdp.mjs';
const page = await cdp();
const { evaljs, send } = page;
const wait = ms => new Promise(r => setTimeout(r, ms));

await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.reload', { ignoreCache: true });
await wait(1500);

const r = await evaljs(`(async () => {
  const m = await import('./src/scene/maps/sando.js');
  const WIDTH = 200, LEN = 600;
  const out = { seamMismatches: [], negativeOrCrazy: [], samples: [] };
  // 邊界接縫：沿地圖四邊，own(heightAt) 與 skirt 在 d=1 處應該完全相等
  for (let z = -LEN/2; z <= LEN/2; z += 30) {
    for (const x of [-WIDTH/2, WIDTH/2]) {
      const own = m.heightAt(x, z);
      const skirt = m.skirtHeightAt(x, z);
      const diff = Math.abs(own - skirt);
      if (diff > 0.01) out.seamMismatches.push({ x, z, own: +own.toFixed(3), skirt: +skirt.toFixed(3), diff: +diff.toFixed(3) });
    }
  }
  for (let x = -WIDTH/2; x <= WIDTH/2; x += 30) {
    for (const z of [-LEN/2, LEN/2]) {
      const own = m.heightAt(x, z);
      const skirt = m.skirtHeightAt(x, z);
      const diff = Math.abs(own - skirt);
      if (diff > 0.01) out.seamMismatches.push({ x, z, own: +own.toFixed(3), skirt: +skirt.toFixed(3), diff: +diff.toFixed(3) });
    }
  }
  // 邊界外遠處：確認持續走高、沒有暴跌成負值或出現離譜斷崖
  let prevAvg = null;
  for (let ring = 1.0; ring <= 3.6; ring += 0.2) {
    let sum = 0, n = 0, min = Infinity, max = -Infinity;
    for (let a = 0; a < Math.PI*2; a += Math.PI/12) {
      const x = Math.cos(a) * (WIDTH/2) * ring;
      const z = Math.sin(a) * (LEN/2) * ring;
      const h = m.skirtHeightAt(x, z);
      sum += h; n++; min = Math.min(min,h); max = Math.max(max,h);
    }
    const avg = sum/n;
    out.samples.push({ ring: +ring.toFixed(1), avg: +avg.toFixed(1), min: +min.toFixed(1), max: +max.toFixed(1) });
    if (prevAvg !== null && avg < prevAvg - 15) out.negativeOrCrazy.push({ ring, avg, prevAvg, note: '突然下降' });
    prevAvg = avg;
  }
  return JSON.stringify(out, null, 1);
})()`, true);
console.log(r);
page.close();
process.exit(0);
