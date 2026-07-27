import { REGION_BY_ID } from '../src/config.js';
import { terrainHeight } from '../src/world/terrain.js';
const spots = [
  ['shrine gate trigger',      'shrine',      -150,  40],
  ['shrine entry from_neth',   'shrine',      -126,  34],
  ['moriya gate trigger',      'moriya',       -30, -80],
  ['moriya entry from_tenkai', 'moriya',       -18, -64],
  ['muenzuka gate trigger',    'muenzuka',     -90,  60],
  ['muenzuka entry from_higan','muenzuka',     -70,  46],
  ['neth entry from_shrine',   'netherworld',    0,  90],
  ['neth trigger to shrine',   'netherworld',    0, 112],
  ['tenkai entry from_moriya', 'tenkai',         0,  60],
  ['tenkai trigger to moriya', 'tenkai',         0,  88],
  ['higan entry from_muenzuka','higan',          0,  90],
  ['higan trigger to muenzuka','higan',          0, 112],
];
for (const [name, reg, lx, lz] of spots) {
  const r = REGION_BY_ID[reg];
  const h = terrainHeight(r.x + lx, r.z + lz);
  console.log(name.padEnd(28), 'world(' + (r.x+lx) + ',' + (r.z+lz) + ')', 'h=' + h.toFixed(1), 'elev=' + r.elev);
}
