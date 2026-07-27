import { REGION_BY_ID } from '../src/config.js';
import { terrainHeight } from '../src/world/terrain.js';
console.log('--- tenkai z 剖面（local x=0）---');
const T = REGION_BY_ID.tenkai;
for (const lz of [60, 66, 70, 72, 74, 76, 78, 80, 84]) {
  console.log('z=' + lz, 'h=' + terrainHeight(T.x, T.z + lz).toFixed(1));
}
console.log('--- muenzuka gate 周圍（local）---');
const M = REGION_BY_ID.muenzuka;
for (const [lx, lz] of [[-90,60],[-90,50],[-90,70],[-80,60],[-100,60],[-70,46],[-60,40],[-50,30],[-40,20],[-90,40],[-90,30]]) {
  console.log(`(${lx},${lz})`, 'h=' + terrainHeight(M.x + lx, M.z + lz).toFixed(1));
}
