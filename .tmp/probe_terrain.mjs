import { terrainHeight } from '../src/world/terrain.js';
import { REGION_BY_ID } from '../src/config.js';
const R = REGION_BY_ID.shrine;
console.log('shrine center', R.x, R.z, 'elev', R.elev);
for (let z = -200; z <= 30; z += 10) {
  console.log(`z=${z}  h=${terrainHeight(R.x, R.z + z).toFixed(2)}`);
}
console.log('--- 參道橫向 (z=-140, x -20..20) ---');
let row='';
for (let x=-20; x<=20; x+=5) row += `${x}:${terrainHeight(R.x+x, R.z-140).toFixed(1)}  `;
console.log(row);
