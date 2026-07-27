import { REGION_BY_ID, CRATER_LAKE } from '../src/config.js';
import { terrainHeight } from '../src/world/terrain.js';
const M = REGION_BY_ID.moriya;
console.log('crater local center:', CRATER_LAKE.x - M.x, CRATER_LAKE.z - M.z, 'r=' + CRATER_LAKE.r, 'waterY=' + CRATER_LAKE.waterY);
const cands = [
  [-100, 40], [-110, 20], [-90, 60], [-120, 0], [-80, 80],
  [60, 60], [80, 40], [70, 80], [40, 90], [90, 20],
  [-60, 100], [-40, 110], [0, 120], [30, 100],
];
for (const [lx, lz] of cands) {
  const wx = M.x + lx, wz = M.z + lz;
  const h = terrainHeight(wx, wz);
  const dc = Math.hypot(wx - CRATER_LAKE.x, wz - CRATER_LAKE.z);
  const wet = dc < CRATER_LAKE.r + 8 && h < CRATER_LAKE.waterY;
  console.log(`(${lx},${lz})`.padEnd(12), 'h=' + h.toFixed(1).padStart(6), 'dc=' + dc.toFixed(0).padStart(4), wet ? ' 水下!' : ' 乾');
}
