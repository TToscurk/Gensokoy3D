// 幻想鄉地形 → UE5 Landscape heightmap 烘焙
// 用法: node .tmp/bake_heightmap.mjs [--flip]
//   --flip  翻轉 RAW 列方向（UE 匯入後發現南北鏡像時重跑用）
//
// 輸出到 .tmp/ue5_export/：
//   gensokyo_1025.r16   16-bit LE RAW（UE5 Landscape Import from File 用）
//   preview.png         8-bit 灰階預覽（上北下南、左西右東）
//   import_notes.json   UE 匯入參數（Z scale / actor Z）+ 地區座標換算表
//
// 不改任何現有程式；依賴 node_modules/three 的手寫 stub 讓 Node 能 import terrain.js。

import { writeFileSync, mkdirSync } from 'fs';
import { deflateSync } from 'zlib';
import { terrainHeight } from '../src/world/terrain.js';
import { REGIONS, WORLD } from '../src/config.js';

const FLIP = process.argv.includes('--flip');
const N = 1025;                       // UE 建議尺寸
const HALF = WORLD.size / 2;          // 1200
const STEP = WORLD.size / (N - 1);    // 2.34375 m/頂點
const OUT = new URL('./ue5_export/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// 1. 採樣（列 = z 由北 -1200 → 南 +1200；行 = x 由西 -1200 → 東 +1200）
// ---------------------------------------------------------------------------
const heights = new Float32Array(N * N);
let hMin = Infinity, hMax = -Infinity;
for (let j = 0; j < N; j++) {
  const z = -HALF + j * STEP;
  for (let i = 0; i < N; i++) {
    const h = terrainHeight(-HALF + i * STEP, z);
    heights[j * N + i] = h;
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }
}
const hMid = (hMin + hMax) / 2;
console.log(`範圍: min=${hMin.toFixed(2)}  max=${hMax.toFixed(2)}  mid=${hMid.toFixed(2)}  全幅=${(hMax - hMin).toFixed(2)} m`);

// ---------------------------------------------------------------------------
// 2. RAW（16-bit LE）：32768 對應 hMid，UE 端 Z scale 補回全幅
// ---------------------------------------------------------------------------
const raw = Buffer.alloc(N * N * 2);
for (let j = 0; j < N; j++) {
  const row = FLIP ? N - 1 - j : j;
  for (let i = 0; i < N; i++) {
    const v = Math.round((heights[row * N + i] - hMid) / (hMax - hMin) * 65535 + 32768);
    raw.writeUInt16LE(Math.max(0, Math.min(65535, v)), (j * N + i) * 2);
  }
}
writeFileSync(OUT + 'gensokyo_1025.r16', raw);

// ---------------------------------------------------------------------------
// 3. 預覽 PNG（8-bit 灰階，最小手寫 encoder，不裝套件）
// ---------------------------------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; ihdr[9] = 0;             // 8-bit, grayscale
const scan = Buffer.alloc(N * (N + 1));
for (let j = 0; j < N; j++) {
  scan[j * (N + 1)] = 0;              // filter: none
  for (let i = 0; i < N; i++) {
    scan[j * (N + 1) + 1 + i] = Math.round((heights[j * N + i] - hMin) / (hMax - hMin) * 255);
  }
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(scan, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(OUT + 'preview.png', png);

// ---------------------------------------------------------------------------
// 4. 匯入筆記：UE 參數 + 地區座標（web → UE：北 = -z → +X，東 = +x → +Y）
// ---------------------------------------------------------------------------
const notes = {
  heightmap: 'gensokyo_1025.r16',
  resolution: N,
  worldSizeMeters: WORLD.size,
  vertexSpacingMeters: STEP,
  heightMeters: { min: +hMin.toFixed(2), max: +hMax.toFixed(2), mid: +hMid.toFixed(2) },
  ueImport: {
    zScale: +((hMax - hMin) / 5.12).toFixed(3),   // UE: 512m 全幅 = scale 100
    landscapeActorZcm: Math.round(hMid * 100),     // 值 32768 = hMid 公尺
    note: 'Landscape actor X/Y 設 0 即世界置中；若南北鏡像，用 --flip 重跑',
  },
  waterLevelMeters: WORLD.waterLevel,
  regionsUE: REGIONS.map(r => ({
    id: r.id, zh: r.zh,
    x_cm: Math.round(-r.z * 100),   // UE +X = 北
    y_cm: Math.round(r.x * 100),    // UE +Y = 東
    elev_cm: Math.round(r.elev * 100),
    radius_m: r.radius,
  })),
};
writeFileSync(OUT + 'import_notes.json', JSON.stringify(notes, null, 2));

// ---------------------------------------------------------------------------
// 5. 抽查錨點（對照 config 的 elev，誤差應在各地區 rough 範圍內）
// ---------------------------------------------------------------------------
console.log('\n錨點抽查（實測 vs config elev）:');
for (const [name, x, z, elev] of [
  ['博麗神社', 855, -175, 104], ['霧之湖', -430, -400, -14], ['天界', 350, -880, 340],
]) {
  console.log(`  ${name}  ${terrainHeight(x, z).toFixed(1)}  vs  ${elev}`);
}
console.log(`\n輸出完成 → ${OUT}`);
console.log(`UE 匯入參數: Z scale=${notes.ueImport.zScale}  actor Z=${notes.ueImport.landscapeActorZcm} cm`);
