// 從 Poly Haven (CC0) 下載 PBR 貼圖集到 assets/textures/
// 用法: node .tmp/download_textures.mjs [--sets plaster,stone_path] [--res 2k]
//   不帶參數 = 全部 1K 重抓
//   --res 2k 時檔名不變（直接覆蓋 1K 版），載入路徑不用改
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const OUT = path.resolve('assets/textures');
const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
};
const onlySets = argOf('--sets')?.split(',') ?? null;
const RES = argOf('--res') ?? '1k';

// [用途, 素材 id] —— 全部 CC0: https://polyhaven.com/license
const SETS = [
  // 地形 splat 層
  ['terrain_grass',   'aerial_grass_rock'],
  ['terrain_forest',  'forest_leaves_02'],
  ['terrain_rock',    'rock_face_03'],
  ['terrain_path',    'stony_dirt_path'],
  ['terrain_sand',    'coast_sand_02'],
  ['terrain_snow',    'snow_02'],
  // 建築
  ['plaster',         'white_plaster_02'],       // 白灰泥牆（神社/民房）
  ['planks',          'weathered_brown_planks'], // 風化木板牆
  ['wood_frame',      'wood_planks'],            // 木構件/樑柱
  ['roof_kawara',     'grey_roof_tiles'],        // 日式瓦
  ['roof_thatch',     'reed_roof_04'],           // 茅草（村屋變化）
  ['brick_red',       'castle_brick_02_red'],    // 紅魔館磚牆
  ['stone_wall',      'japanese_stone_wall'],    // 日式石垣
  ['stone_path',      'grey_stone_path'],        // 參道/石階
  ['cobble',          'cobblestone_05'],         // 村里街道
  ['deck',            'wood_floor_deck'],        // 緣側/木地板
  // 植被
  ['bark_cedar',      'japanese_cedar_bark'],    // 杉木樹皮
  ['bark_sakura',     'sakura_bark'],            // 櫻花樹皮

  // ---- 2026-07 擴充：室內與地形細節 ----
  ['tatami',          'tatami_mat'],             // 神社室內：榻榻米
  ['velvet_red',      'velour_velvet'],          // 紅魔館室內：絨毯/窗簾
  ['marble_check',    'floor_tiles_06'],         // 紅魔館室內：棋盤格大理石地板
  ['marble_plain',    'marble_tiles'],           // 紅魔館室內：素面大理石（牆面/柱）
  ['cliff_rock',      'cliff_side'],             // 妖怪之山：懸崖峭壁
  ['grave_stone',     'mossy_sandstone'],        // 無緣塚：長苔的墓石
  ['dark_wood',       'dark_wood'],              // 紅魔館室內：深色木地板/家具
];

const MAPS = ['diff', 'nor_gl', 'rough'];

const url = (id, map) =>
  `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/${RES}/${id}/${id}_${map}_${RES}.jpg`;

await mkdir(OUT, { recursive: true });

let done = 0, failed = [];
const manifest = { source: 'Poly Haven (polyhaven.com)', license: 'CC0', downloaded: new Date().toISOString(), sets: {} };

for (const [name, id] of SETS) {
  if (onlySets && !onlySets.includes(name)) continue;
  manifest.sets[name] = { id, res: RES, files: [] };
  for (const map of MAPS) {
    const fname = `${name}_${map}.jpg`;
    try {
      const r = await fetch(url(id, map));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      await writeFile(path.join(OUT, fname), buf);
      manifest.sets[name].files.push(fname);
      done++;
      process.stdout.write(`\r${done}/${SETS.length * MAPS}  ${fname} (${(buf.length / 1024) | 0}KB)          `);
    } catch (e) {
      failed.push(`${fname}: ${e.message}`);
    }
  }
}

// 部分重抓（--sets）不重寫 manifest —— 完整清單是全量跑時的產物
if (!onlySets) await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n完成 ${done} 張, 失敗 ${failed.length} 張`);
if (failed.length) console.log('失敗清單:\n' + failed.join('\n'));
