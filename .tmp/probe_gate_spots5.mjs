import { REGION_BY_ID, CRATER_LAKE } from '../src/config.js';
import { terrainHeight } from '../src/world/terrain.js';
const M = REGION_BY_ID.moriya;
for (const [lx, lz] of [[-16,18],[-12,8],[-10,4],[-20,10],[-14,24],[-18,14],[-22,20],[-8,14]]) {
  const wx = M.x + lx, wz = M.z + lz;
  const h = terrainHeight(wx, wz);
  const dc = Math.hypot(wx - CRATER_LAKE.x, wz - CRATER_LAKE.z);
  console.log(`(${lx},${lz})`.padEnd(12), 'h=' + h.toFixed(1).padStart(6), 'dc=' + dc.toFixed(0).padStart(4));
}
