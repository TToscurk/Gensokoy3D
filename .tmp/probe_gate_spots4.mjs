import { REGION_BY_ID, CRATER_LAKE } from '../src/config.js';
import { terrainHeight } from '../src/world/terrain.js';
const M = REGION_BY_ID.moriya;
const cands = [
  [0,60],[-20,55],[20,55],[40,45],[55,20],[45,0],[0,45],[-25,30],
  [40,-20],[55,-35],[30,-45],[60,-10],[70,-30],[45,-45],[35,60],[50,45],
];
for (const [lx, lz] of cands) {
  const wx = M.x + lx, wz = M.z + lz;
  const h = terrainHeight(wx, wz);
  const dc = Math.hypot(wx - CRATER_LAKE.x, wz - CRATER_LAKE.z);
  console.log(`(${lx},${lz})`.padEnd(12), 'h=' + h.toFixed(1).padStart(6), 'dc=' + dc.toFixed(0).padStart(4), h > 345 ? ' ← 平台上' : '');
}
