import { REGION_BY_ID } from '../src/config.js';
import { terrainHeight } from '../src/world/terrain.js';
for (const id of ['higan','netherworld','tenkai']) {
  const R = REGION_BY_ID[id];
  console.log('---', id, 'elev=' + R.elev);
  for (const [lx,lz] of [[0,0],[0,-20],[0,26],[-8,24],[0,40],[0,60],[0,90],[30,0],[-30,0]]) {
    console.log(`(${lx},${lz})`.padEnd(12), 'h=' + terrainHeight(R.x+lx, R.z+lz).toFixed(1));
  }
}
