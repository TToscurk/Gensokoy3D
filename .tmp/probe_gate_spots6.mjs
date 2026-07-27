import { REGION_BY_ID } from '../src/config.js';
import { terrainHeight } from '../src/world/terrain.js';
const S = REGION_BY_ID.shrine;
console.log('--- shrine 西坡回平台路徑 ---');
for (const [lx,lz] of [[-150,40],[-140,38],[-126,34],[-110,28],[-95,22],[-80,15],[-60,8],[-45,4],[-30,0]]) {
  console.log(`(${lx},${lz})`.padEnd(12), 'h=' + terrainHeight(S.x+lx, S.z+lz).toFixed(1));
}
console.log('--- tenkai (0,44) ---');
const T = REGION_BY_ID.tenkai;
console.log('h=' + terrainHeight(T.x, T.z+44).toFixed(1));
