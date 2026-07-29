import * as THREE from 'three';
import { fbm, ridged, noise2, smoothstep, clamp, lerp } from '../core/noise.js';
import { WORLD, REGIONS, REGION_BY_ID, CRATER_LAKE, RIVER } from '../config.js';
import { pbrSet, stoneTexture } from '../core/textures.js';

// ---------------------------------------------------------------------------
// 高度場
// ---------------------------------------------------------------------------
// 這個函式是整個世界的唯一真相：地形網格、玩家碰撞、植被落點、
// 建築擺放全都呼叫它，所以視覺與物理不可能對不上。

export function terrainHeight(x, z) {
  // 大尺度起伏
  let h = fbm(x * 0.00085, z * 0.00085, 4) * 62;
  // 稜線
  h += ridged(x * 0.0021, z * 0.0021, 3) * 16;
  // 中頻細節
  h += fbm(x * 0.0062, z * 0.0062, 3) * 6.5;
  // 高頻碎石
  h += noise2(x * 0.031, z * 0.031) * 1.1;
  h += 14;

  // 地區壓平：把每個地標所在地捏成適合蓋東西的平台
  for (let i = 0; i < REGIONS.length; i++) {
    const r = REGIONS[i];
    const dx = x - r.x, dz = z - r.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const w = 1 - smoothstep(r.radius * 0.42, r.radius, d);
    if (w <= 0.0005) continue;
    if (r.peak) {
      // 火山錐：t=1 在峰心、0 在山域邊緣；1.35 次方讓山腳緩、山腰陡
      const t = Math.max(0, 1 - d / (r.radius * 0.98));
      // 火口附近收斂雜訊 —— 湖緣必須完整高於水面，不能被起伏咬出缺口
      const calm = 0.05 + 0.95 * smoothstep(r.craterR + 8, r.craterR + 48, d);
      let local = r.elev + Math.pow(t, 1.35) * r.peakH
                + fbm(x * 0.008, z * 0.008, 3) * r.rough * (0.35 + 0.65 * t) * calm;
      local -= r.craterDepth * (1 - smoothstep(0, r.craterR, d));              // 火口下陷
      local += r.rimH * (1 - smoothstep(0, 16, Math.abs(d - r.craterR - 4)));  // 火口緣凸起
      h = lerp(h, local, w);
      continue;
    }
    const local = r.elev + fbm(x * 0.011, z * 0.011, 2) * r.rough;
    h = lerp(h, local, w);
  }

  // 風神湖湖床（在地區之後壓，才能切穿火山口緣形成溢流口）
  {
    const dc = Math.hypot(x - CRATER_LAKE.x, z - CRATER_LAKE.z);
    const cw = 1 - smoothstep(CRATER_LAKE.r * 0.55, CRATER_LAKE.r + 8, dc);
    if (cw > 0) h = lerp(h, CRATER_LAKE.bed + fbm(x * 0.03, z * 0.03, 2) * 1.2, cw);
  }
  // 山溪河道：對折線的距離場，把高度壓向沿線河床（河床測站單調遞減）
  {
    const rv = riverSample(x, z);
    if (rv.w > 0) h = lerp(h, rv.bed, rv.w);
  }

  // 地圖邊界：外圍抬起成環形山，把玩家溫柔地留在幻想鄉內
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const rim = smoothstep(WORLD.size * 0.42, WORLD.size * 0.56, edge);
  h = lerp(h, h + 130 + fbm(x * 0.004, z * 0.004, 3) * 45, rim);

  return h;
}

// ---------------------------------------------------------------------------
// 現行高度場（分圖改造 —— SCENE_MANAGER_SPEC §4 #1）
// ---------------------------------------------------------------------------
// 分圖之後不再有「全世界」的高度場，只有「現在載著的那張圖」的。
//
// 跟著玩家跑的東西（碰撞、相機、NPC、敵人、草地、粒子）一律改讀
// `groundHeight()`；manager 在載圖時把指標換成該地圖的 `heightAt`。
// 反過來，「建構 legacy_open 內容」的程式（buildTerrain、structures、
// mapview 的底圖烘焙、水面）繼續直接用 `terrainHeight` —— 那些是舊世界
// 這張圖自己的地形，不該跟著別張圖跑。
let _heightField = terrainHeight;

/** manager 專用：把現行高度場換成某張地圖的。傳 null 還原成舊世界。 */
export function setHeightField(fn) {
  _heightField = fn || terrainHeight;
}

export function currentHeightField() {
  return _heightField;
}

/** 現行地圖的地面高度。 */
export function groundHeight(x, z) {
  return _heightField(x, z);
}

const _n = new THREE.Vector3();
export function terrainNormal(x, z, eps = 1.2) {
  const hL = groundHeight(x - eps, z), hR = groundHeight(x + eps, z);
  const hD = groundHeight(x, z - eps), hU = groundHeight(x, z + eps);
  return _n.set(hL - hR, 2 * eps, hD - hU).normalize();
}

/** 河道取樣：回傳離折線最近的河床高與下壓權重（半寬 5 河床 + 9 岸坡） */
export function riverSample(x, z) {
  let bestD = 1e9, bestBed = 0;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i], b = RIVER[i + 1];
    const vx = b[0] - a[0], vz = b[1] - a[1];
    const tt = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz), 0, 1);
    const px = a[0] + vx * tt, pz = a[1] + vz * tt;
    const dd = Math.hypot(x - px, z - pz);
    if (dd < bestD) { bestD = dd; bestBed = a[2] + (b[2] - a[2]) * tt; }
  }
  return { bed: bestBed, w: 1 - smoothstep(5, 14, bestD) };
}

/** 坡度 0（平地）~ 1（垂直） */
export function terrainSlope(x, z) {
  return 1 - terrainNormal(x, z).y;
}

/** 目前所在地區（不在任何地區內回傳 null） */
export function regionAt(x, z) {
  let best = null, bestScore = 0;
  for (const r of REGIONS) {
    const dx = x - r.x, dz = z - r.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const s = 1 - smoothstep(r.radius * 0.55, r.radius * 1.25, d);
    // 平手時取半徑小者 —— 不然整座守矢神社都會被判成「妖怪之山」
    if (s > bestScore + 1e-6 ||
        (Math.abs(s - bestScore) <= 1e-6 && best && r.radius < best.radius)) {
      bestScore = s; best = r;
    }
  }
  return bestScore > 0.25 ? best : null;
}

// ---------------------------------------------------------------------------
// 生態著色 + 貼圖層混合
// ---------------------------------------------------------------------------
const C = {
  grass:    new THREE.Color(0x6f8f4e),
  grassDry: new THREE.Color(0x93a05a),
  forest:   new THREE.Color(0x3d5c3a),
  rock:     new THREE.Color(0x7d7368),
  rockDark: new THREE.Color(0x574f49),
  sand:     new THREE.Color(0xcbbc94),
  snow:     new THREE.Color(0xe8eef2),
  path:     new THREE.Color(0xa89a80),
  sakura:   new THREE.Color(0xc9a3b4),
  bamboo:   new THREE.Color(0x7d9a55),
};

// splat 六層（與 shader 的取樣順序對應）：
// A = [草地, 森林落葉, 岩石, 土路]   B = [沙, 雪]
// 每層貼圖的平均色（目測估值，linear），用來把 vertex color
// 正規化成「相對色調」—— 這樣貼圖負責細節、vertex color 負責宏觀變化。
const LAYER_MEAN = [
  [0.38, 0.42, 0.28],  // grass   aerial_grass_rock
  [0.30, 0.26, 0.18],  // forest  forest_leaves_02
  [0.49, 0.32, 0.20],  // rock    cliff_side（實測平均色；舊值是 rock_face_03 的灰，色差會把山坡染成黃泥）
  [0.45, 0.38, 0.30],  // path    stony_dirt_path
  [0.62, 0.55, 0.42],  // sand    coast_sand_02
  [0.85, 0.87, 0.90],  // snow    snow_02
];

const _tmp = new THREE.Color();

/**
 * 地表綜合取樣：一次算出「宏觀顏色」與「六層貼圖權重」。
 * 兩者共用同一套地區/坡度/高度邏輯，保證顏色與貼圖永遠一致。
 * @param out      宏觀色（會被正規化為相對於層平均色的色調）
 * @param splatA   vec4 陣列輸出 [grass, forest, rock, path]
 * @param splatB   vec2 輸出 [sand, snow]
 */
export function groundSample(x, z, h, slope, out, splatA, splatB) {
  // 基底：草地，隨雜訊在乾濕之間變化
  const v = fbm(x * 0.004, z * 0.004, 3) * 0.5 + 0.5;
  out.copy(C.grass).lerp(C.grassDry, v * 0.75);

  let gW = 1, fW = 0, rW = 0, pW = 0, sW = 0, snW = 0;

  // 地區覆蓋
  const reg = regionAt(x, z);
  if (reg) {
    const dx = x - reg.x, dz = z - reg.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const w = 1 - smoothstep(reg.radius * 0.5, reg.radius * 1.15, d);
    if (reg.id === 'forest')      { out.lerp(C.forest, w * 0.85); fW = w * 0.85; }
    else if (reg.id === 'netherworld') { out.lerp(C.sakura, w * 0.6); snW = Math.max(snW, w * 0.75); }
    else if (reg.id === 'bamboo') { out.lerp(C.bamboo, w * 0.7); fW = w * 0.7; }
    // 神社：境內石板參道混石苔，外緣坡地混岩層——避免整片神社地皮同一種灰
    else if (reg.id === 'shrine') {
      const nearCore = 1 - smoothstep(0, reg.radius * 0.55, d);
      out.lerp(C.path, w * (0.22 + 0.18 * nearCore));
      pW = w * (0.24 + 0.2 * nearCore);
      rW = Math.max(rW, w * 0.14 * (1 - nearCore));
      fW = Math.max(fW, w * 0.10 * nearCore);
    }
    else if (reg.id === 'sdm')    { out.lerp(C.rockDark, w * 0.3); rW = w * 0.3; }
    else if (reg.id === 'village')    { out.lerp(C.path, w * 0.3); pW = Math.max(pW, w * 0.38); }
    else if (reg.id === 'muenzuka')   { out.lerp(C.path, w * 0.4); pW = Math.max(pW, w * 0.45); }
    else if (reg.id === 'myouren')    { out.lerp(C.path, w * 0.2); pW = Math.max(pW, w * 0.25); }
    else if (reg.id === 'tenguVillage') { out.lerp(C.path, w * 0.32); pW = Math.max(pW, w * 0.36); rW = Math.max(rW, w * 0.15); }
    // 守矢神社：山頂湖畔的參道土面混岩，不能讓全域雪線染成白一片
    else if (reg.id === 'moriya')     { out.lerp(C.path, w * 0.3); pW = Math.max(pW, w * 0.3); rW = Math.max(rW, w * 0.22); }
    // 妖怪之山：基調偏岩（高海拔的休眠火山）
    else if (reg.id === 'youkaiMountain') { rW = Math.max(rW, w * 0.3); }
    // 天界：雲上的白石台地，不管坡度高度都該是接近雪色的素淨石面
    else if (reg.id === 'tenkai')     { out.lerp(C.snow, w * 0.7); snW = Math.max(snW, w * 0.7); }
    // 彼岸：三途川岸的灰燼色沙地
    else if (reg.id === 'higan')      { out.lerp(C.rockDark, w * 0.5); rW = Math.max(rW, w * 0.4); sW = Math.max(sW, w * 0.25); }
  }

  // 水岸沙地。
  // 只看高度是不夠的 —— 人間之里的地基高度剛好落在同一區間，
  // 整座村子會被塗成沙漠。必須同時要求「離湖夠近」。
  // 兩座湖各自判：霧之湖（水面 0）與山頂的風神湖（水面 342）。
  const lake = REGION_BY_ID.lake;
  const dLake = Math.hypot(x - lake.x, z - lake.z);
  const byLake = 1 - smoothstep(lake.radius * 0.85, lake.radius * 1.55, dLake);
  const dCrater = Math.hypot(x - CRATER_LAKE.x, z - CRATER_LAKE.z);
  const byCrater = 1 - smoothstep(CRATER_LAKE.r * 0.95, CRATER_LAKE.r * 1.28, dCrater);
  const shore = Math.max(
    (1 - smoothstep(0.5, 6.0, h - WORLD.waterLevel)) * byLake,
    (1 - smoothstep(0.5, 3.0, h - CRATER_LAKE.waterY)) * byCrater);
  if (shore > 0) { out.lerp(C.sand, shore * 0.92); sW = shore * 0.92; }

  // 陡坡露出岩石
  const rocky = smoothstep(0.28, 0.62, slope);
  if (rocky > 0) {
    _tmp.copy(C.rock).lerp(C.rockDark, fbm(x * 0.02, z * 0.02, 2) * 0.5 + 0.5);
    out.lerp(_tmp, rocky);
    rW = Math.max(rW, rocky);
  }

  // 峰頂斑塊殘雪（只出現在火山口緣以上；低海拔地區的白是各自地區分支管的）
  const snowy = smoothstep(356, 378, h)
              * (1 - smoothstep(0.5, 0.8, slope))
              * (0.35 + 0.65 * (fbm(x * 0.02, z * 0.02, 2) * 0.5 + 0.5));
  if (snowy > 0) { out.lerp(C.snow, snowy); snW = Math.max(snW, snowy); }

  // 正規化權重
  const total = gW + fW + rW + pW + sW + snW;
  const inv = 1 / total;
  gW *= inv; fW *= inv; rW *= inv; pW *= inv; sW *= inv; snW *= inv;
  if (splatA) { splatA[0] = gW; splatA[1] = fW; splatA[2] = rW; splatA[3] = pW; }
  if (splatB) { splatB[0] = sW; splatB[1] = snW; }

  // 把顏色正規化成「相對於當前層混合平均色」的色調：
  // 貼圖提供亮度與細節，vertex color 只帶走地區性的色相偏移。
  const mr = LAYER_MEAN[0][0] * gW + LAYER_MEAN[1][0] * fW + LAYER_MEAN[2][0] * rW +
             LAYER_MEAN[3][0] * pW + LAYER_MEAN[4][0] * sW + LAYER_MEAN[5][0] * snW;
  const mg = LAYER_MEAN[0][1] * gW + LAYER_MEAN[1][1] * fW + LAYER_MEAN[2][1] * rW +
             LAYER_MEAN[3][1] * pW + LAYER_MEAN[4][1] * sW + LAYER_MEAN[5][1] * snW;
  const mb = LAYER_MEAN[0][2] * gW + LAYER_MEAN[1][2] * fW + LAYER_MEAN[2][2] * rW +
             LAYER_MEAN[3][2] * pW + LAYER_MEAN[4][2] * sW + LAYER_MEAN[5][2] * snW;
  out.r = clamp(out.r / Math.max(mr, 0.05), 0.55, 1.9);
  out.g = clamp(out.g / Math.max(mg, 0.05), 0.55, 1.9);
  out.b = clamp(out.b / Math.max(mb, 0.05), 0.55, 1.9);

  return out;
}

/** 依高度、坡度、地區決定地表顏色（草地染色等舊介面沿用） */
export function biomeColor(x, z, h, slope, out = new THREE.Color()) {
  return groundSample(x, z, h, slope, out, null, null);
}

// ---------------------------------------------------------------------------
// 網格建構
// ---------------------------------------------------------------------------

// 六層 PBR 貼圖（CC0, Poly Haven），世界座標 XZ 平鋪。
// 單位：每幾公尺重複一次。
const LAYERS = [
  { name: 'terrain_grass',  scale: 1 / 5.0,  rough: 0.95, fallback: '#5a7040' },
  { name: 'terrain_forest', scale: 1 / 4.5,  rough: 1.0,  fallback: '#4a3f2a' },
  // 陡坡層用懸崖岩壁照（cliff_side）—— 原 rock_face_03 鋪在大坡度上會糊成
  // 一片泥色斜紋；換層不換索引，splat shader 不動。
  { name: 'cliff_rock',     scale: 1 / 9.0,  rough: 0.92, fallback: '#6a655c' },
  { name: 'terrain_path',   scale: 1 / 4.0,  rough: 0.95, fallback: '#7a6a50' },
  { name: 'terrain_sand',   scale: 1 / 5.5,  rough: 1.0,  fallback: '#9a8a68' },
  { name: 'terrain_snow',   scale: 1 / 6.5,  rough: 0.82, fallback: '#e0e4e8' },
];

function layerTextures() {
  // 備援是程序石板紋調成各層的代表色 —— 檔案缺失時世界仍然完整且色調正確
  const sets = LAYERS.map((L) => pbrSet(L.name, stoneTexture(L.fallback, 8), {
    rough: L.rough, aniso: 8,
  }));
  return sets;
}

/**
 * @param segments  網格分割數
 * @param opts.size 邊長（預設整個世界）
 * @param opts.ox/oz 這塊地形在世界座標裡的中心。給定時網格用「局部座標」
 *   （中心為原點），但高度與著色仍照世界座標取樣 —— 分圖要的就是這個：
 *   一張 420×420 的小圖有自己的原點，地貌卻和舊世界完全對得上。
 */
/**
 * 遠景裙襬 —— 地圖自己的地形之外那一圈背景地形。
 *
 * 小圖只有 400～600 公尺，霧的遠端在 900 公尺：不補這一圈，地形會在
 * 霧遮住之前就被切出一條硬邊，外面是空的（使用者說的「場景外的白色」）。
 *
 * 做法是一圈中空的方環，內緣貼齊地圖邊界、外緣延伸到霧之外。解析度刻意
 * 很低（遠景不需要細節），成本是 1 個 draw call、幾千個三角形。
 *
 * @param inner   內緣半邊長（＝地圖的 size/2），可傳 {x, z} 給長方形圖
 * @param outer   外緣半邊長（建議 ≥ 霧的遠端）
 * @param sample  (x, z) => 高度。'world' 的圖傳「局部轉世界再取樣」的函式，
 *                'local' 的圖傳自己的 skirtHeightAt（負責平滑過渡）。
 * @param rings   環的圈數，越多越平滑
 */
// 裙邊材質登記簿：SkySystem 每幀照太陽高度調自發光強度與顏色，
// 白天是大氣散射補光、晚上收斂近零（不然夜裡裙邊會亮成一條白帶）。
// 地圖卸載後留下的舊材質只是參照，量小不傷效能。
export const skirtMats = [];

/**
 * 遠景用的六層 splat 材質 —— 給裙襬用。
 *
 * 和主地形共用同一批 CC0 貼圖與同一套「世界座標 XZ 當 UV」的取樣方式，
 * 所以裙襬的紋理會和圖內地形**接得起來**（同一個相位、同一個平鋪尺度），
 * 不會在圖邊出現一條材質分界。這是分圖之後「地圖外是白色地板」的解法：
 * 白不是因為沒地形，是因為裙襬本來只有頂點色、沒有貼圖。
 *
 * 精簡掉法線貼圖：主地形的法線本來就在 90 公尺外淡出，而裙襬整片都在
 * 那之外 —— 少 6 次 fragment 貼圖讀取，對內顯是實在的節省。
 */
function farSplatMaterial() {
  const sets = layerTextures();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1.0, metalness: 0,
    // 背光面只靠 hemi 會黑成一片。墊一點霧色自發光模擬大氣散射，
    // 遠山背光面才不會在霧色背景前黑成剪影。SkySystem 每幀調強度。
    emissive: 0xaebfd0, emissiveIntensity: 0.22,
  });
  mat.onBeforeCompile = (shader) => {
    for (let i = 0; i < 6; i++) {
      shader.uniforms[`uDiff${i}`] = { value: sets[i].map };
      shader.uniforms[`uScale${i}`] = { value: LAYERS[i].scale };
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aSplatA;
        attribute vec4 aSplatB;
        varying vec4 vSplatA;
        varying vec4 vSplatB;
        varying vec3 vWPosF;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplatA = aSplatA;
        vSplatB = aSplatB;`)
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n  vWPosF = (modelMatrix * vec4(transformed,1.0)).xyz;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDiff0; uniform sampler2D uDiff1; uniform sampler2D uDiff2;
        uniform sampler2D uDiff3; uniform sampler2D uDiff4; uniform sampler2D uDiff5;
        uniform float uScale0; uniform float uScale1; uniform float uScale2;
        uniform float uScale3; uniform float uScale4; uniform float uScale5;
        varying vec4 vSplatA;
        varying vec4 vSplatB;
        varying vec3 vWPosF;`)
      .replace('#include <color_fragment>', `
        vec2 uvwF = vWPosF.xz;
        vec3 albF =
          texture2D(uDiff0, uvwF * uScale0).rgb * vSplatA.x +
          texture2D(uDiff1, uvwF * uScale1).rgb * vSplatA.y +
          texture2D(uDiff2, uvwF * uScale2).rgb * vSplatA.z +
          texture2D(uDiff3, uvwF * uScale3).rgb * vSplatA.w +
          texture2D(uDiff4, uvwF * uScale4).rgb * vSplatB.x +
          texture2D(uDiff5, uvwF * uScale5).rgb * vSplatB.y;
        #ifdef USE_COLOR
          diffuseColor.rgb *= vColor;
        #endif
        diffuseColor.rgb *= albF;`);
  };
  skirtMats.push(mat);
  return mat;
}


export function buildTerrainSkirt(inner, outer, sample, rings = 10) {  const inX = typeof inner === 'number' ? inner : inner.x;
  const inZ = typeof inner === 'number' ? inner : inner.z;
  const seg = 48;                        // 每邊的分割數（遠景，夠用就好）

  const positions = [], colors = [], indices = [];
  const splatA = [], splatB = [];
  const col = new THREE.Color();
  const a4 = [0, 0, 0, 0], b2 = [0, 0];
  const cols = seg + 1;

  // 從內緣到外緣，一圈一圈往外推。每一圈是一個方框，
  // 用「取最大軸」的方式把方框參數化成 (u, ring)。
  const row0 = new Float64Array(seg + 1);   // 內緣高度：肩部混合的起點
  for (let r = 0; r <= rings; r++) {
    // 非線性外推：靠近地圖的地方密、遠處疏 —— 遠景本來就看不出細節
    const k = Math.pow(r / rings, 1.8);
    const hx = inX + (outer - inX) * k;
    const hz = inZ + (outer - inZ) * k;

    // 肩部混合：圖邊外側的世界地形常常是斷崖（神社高原那種），
    // 直接照取樣會在圖邊立起一圈又薄又黑的牆。前 30% 的環從
    // 內緣高度平滑過渡到真實取樣，遠處才放給世界地形自由起伏。
    let w = Math.min(1, (r / rings) / 0.3);
    w = w * w * (3 - 2 * w);

    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      // 沿方框走一圈：0~0.25 上邊、0.25~0.5 右邊、依此類推
      const a = u * 4;
      let x, z;
      if (a < 1)      { x = -hx + 2 * hx * a;        z = -hz; }
      else if (a < 2) { x = hx;                      z = -hz + 2 * hz * (a - 1); }
      else if (a < 3) { x = hx - 2 * hx * (a - 2);   z = hz; }
      else            { x = -hx;                     z = hz - 2 * hz * (a - 3); }

      let h = sample(x, z);
      if (r === 0) row0[i] = h;
      else h = row0[i] + (h - row0[i]) * w;
      positions.push(x, h, z);
      // 和主地形完全一樣的取樣：宏觀色 + 六層權重。
      // 之前只取宏觀色、不取權重（材質也沒貼圖），那正是「圖外是白色地板」
      // 的原因 —— 頂點色是「相對色調」(0.55~1.9)，沒有貼圖乘上去就會發白。
      groundSample(x, z, h, 0.2, col, a4, b2);
      colors.push(col.r, col.g, col.b);
      splatA.push(a4[0], a4[1], a4[2], a4[3]);
      splatB.push(b2[0], b2[1], 0, 0);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < seg; i++) {
      const a = r * cols + i, b = a + 1;
      const c = (r + 1) * cols + i, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aSplatA', new THREE.Float32BufferAttribute(splatA, 4));
  geo.setAttribute('aSplatB', new THREE.Float32BufferAttribute(splatB, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = farSplatMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain-skirt';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  // --- 谷地霧盤 -----------------------------------------------------------
  // 天空球的下半球是爆白的霧霾色，地形剪影以下會直接露出它
  // （地圖外圍那圈白邊）。墊一張大圓盤在最低地形之下：近處是谷地色，
  // 超過霧距就溶進霧色，看起來就是一片延伸到地平線的迷霧低地。
  let minH = Infinity;
  for (let i = 0; i < positions.length / 3; i++) minH = Math.min(minH, positions[i * 3 + 1]);
  // 盤色取最外圈的平均色 —— 跟著當地生態走，不會是一塊死綠。
  //
  // 注意頂點色是「相對色調」（groundSample 把它正規化成相對於各層平均色的
  // 比值，約 0.55~1.9、平均落在 1.0 附近）。直接拿來當 RGB 會是**接近白**，
  // 於是地平線上出現一大片白色平面 —— 那就是使用者說的「地圖外的白色地板」。
  // 要乘回這一圈實際的貼圖平均色，才會是真正的地面顏色。
  let ar = 0, ag = 0, ab = 0;
  const nv = positions.length / 3;
  for (let i = nv - cols; i < nv; i++) {
    // 這一點的六層加權平均反照率
    const wA = [splatA[i * 4], splatA[i * 4 + 1], splatA[i * 4 + 2], splatA[i * 4 + 3]];
    const wB = [splatB[i * 4], splatB[i * 4 + 1]];
    const w = [wA[0], wA[1], wA[2], wA[3], wB[0], wB[1]];
    let mr = 0, mg = 0, mb = 0;
    for (let L = 0; L < 6; L++) { mr += LAYER_MEAN[L][0] * w[L]; mg += LAYER_MEAN[L][1] * w[L]; mb += LAYER_MEAN[L][2] * w[L]; }
    ar += colors[i * 3] * mr;
    ag += colors[i * 3 + 1] * mg;
    ab += colors[i * 3 + 2] * mb;
  }
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(outer * 3, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(ar / cols, ag / cols, ab / cols), roughness: 1.0, metalness: 0,
    })
  );
  floor.name = 'terrain-haze-floor';
  floor.position.y = minH - 25;
  floor.receiveShadow = false;
  floor.castShadow = false;

  const group = new THREE.Group();
  group.name = 'terrain-skirt-group';
  group.add(mesh, floor);
  return group;
}

export function buildTerrain(segments, opts = {}) {
  const size = opts.size ?? WORLD.size;
  // 狹長的圖（參道）用得到長方形；省略就是正方形
  const sizeX = opts.sizeX ?? size, sizeZ = opts.sizeZ ?? size;
  const ox = opts.ox ?? 0, oz = opts.oz ?? 0;
  // 分割數依邊長比例分配，保持每一格大致是正方形
  const segX = Math.max(1, Math.round(segments * sizeX / Math.max(sizeX, sizeZ)));
  const segZ = Math.max(1, Math.round(segments * sizeZ / Math.max(sizeX, sizeZ)));
  const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segX, segZ);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  const splatA = new Float32Array(n * 4);
  const splatB = new Float32Array(n * 4);
  const col = new THREE.Color();
  const a4 = [0, 0, 0, 0], b2 = [0, 0];

  for (let i = 0; i < n; i++) {
    const h = terrainHeight(pos.getX(i) + ox, pos.getZ(i) + oz);
    pos.setY(i, h);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  // 用真正的網格法線算坡度，比再取樣一次高度場便宜
  const nrm = geo.attributes.normal;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i) + ox, z = pos.getZ(i) + oz;
    const h = pos.getY(i);
    groundSample(x, z, h, 1 - nrm.getY(i), col, a4, b2);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
    splatA[i * 4] = a4[0]; splatA[i * 4 + 1] = a4[1];
    splatA[i * 4 + 2] = a4[2]; splatA[i * 4 + 3] = a4[3];
    splatB[i * 4] = b2[0]; splatB[i * 4 + 1] = b2[1];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSplatA', new THREE.BufferAttribute(splatA, 4));
  geo.setAttribute('aSplatB', new THREE.BufferAttribute(splatB, 4));

  const sets = layerTextures();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,          // 各層粗糙度在 shader 裡按權重混合
    metalness: 0.0,
    flatShading: false,
  });

  // splat 著色器：顏色、法線、粗糙度都依頂點權重混六層。
  // UV 直接用世界座標 XZ —— 地形是唯一且不動的，不需要展 UV。
  mat.onBeforeCompile = (shader) => {
    for (let i = 0; i < 6; i++) {
      shader.uniforms[`uDiff${i}`] = { value: sets[i].map };
      shader.uniforms[`uNor${i}`] = { value: sets[i].normalMap };
      shader.uniforms[`uScale${i}`] = { value: LAYERS[i].scale };
      shader.uniforms[`uRough${i}`] = { value: LAYERS[i].rough };
    }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aSplatA;
        attribute vec4 aSplatB;
        varying vec4 vSplatA;
        varying vec4 vSplatB;
        varying vec3 vWPos;
        varying vec3 vWNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplatA = aSplatA;
        vSplatB = aSplatB;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);`)
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n  vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDiff0; uniform sampler2D uDiff1; uniform sampler2D uDiff2;
        uniform sampler2D uDiff3; uniform sampler2D uDiff4; uniform sampler2D uDiff5;
        uniform sampler2D uNor0; uniform sampler2D uNor1; uniform sampler2D uNor2;
        uniform sampler2D uNor3; uniform sampler2D uNor4; uniform sampler2D uNor5;
        uniform float uScale0; uniform float uScale1; uniform float uScale2;
        uniform float uScale3; uniform float uScale4; uniform float uScale5;
        uniform float uRough0; uniform float uRough1; uniform float uRough2;
        uniform float uRough3; uniform float uRough4; uniform float uRough5;
        varying vec4 vSplatA;
        varying vec4 vSplatB;
        varying vec3 vWPos;
        varying vec3 vWNormal;`)
      // 反照率：六層加權混合 × 宏觀色調（vertex color 已正規化成相對色調）
      .replace('#include <color_fragment>', `
        vec2 uvw = vWPos.xz;
        vec3 alb =
          texture2D(uDiff0, uvw * uScale0).rgb * vSplatA.x +
          texture2D(uDiff1, uvw * uScale1).rgb * vSplatA.y +
          texture2D(uDiff2, uvw * uScale2).rgb * vSplatA.z +
          texture2D(uDiff3, uvw * uScale3).rgb * vSplatA.w +
          texture2D(uDiff4, uvw * uScale4).rgb * vSplatB.x +
          texture2D(uDiff5, uvw * uScale5).rgb * vSplatB.y;
        #ifdef USE_COLOR
          diffuseColor.rgb *= vColor;
        #endif
        diffuseColor.rgb *= alb;`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor =
          uRough0 * vSplatA.x + uRough1 * vSplatA.y + uRough2 * vSplatA.z +
          uRough3 * vSplatA.w + uRough4 * vSplatB.x + uRough5 * vSplatB.y;`)
      // 法線：六層 normal map 加權混合，用幾何法線現造 TBN（平面映射）。
      // 遠處淡出 —— 距離一遠每個像素跨越好幾個貼圖週期，會出現摩爾紋。
      .replace('#include <normal_fragment_maps>', `
        {
          float nFade = 1.0 - smoothstep(18.0, 90.0, length(vViewPosition));
          if (nFade > 0.01) {
            vec3 tn =
              (texture2D(uNor0, uvw * uScale0).xyz * 2.0 - 1.0) * vSplatA.x +
              (texture2D(uNor1, uvw * uScale1).xyz * 2.0 - 1.0) * vSplatA.y +
              (texture2D(uNor2, uvw * uScale2).xyz * 2.0 - 1.0) * vSplatA.z +
              (texture2D(uNor3, uvw * uScale3).xyz * 2.0 - 1.0) * vSplatA.w +
              (texture2D(uNor4, uvw * uScale4).xyz * 2.0 - 1.0) * vSplatB.x +
              (texture2D(uNor5, uvw * uScale5).xyz * 2.0 - 1.0) * vSplatB.y;
            tn = normalize(mix(vec3(0.0, 0.0, 1.0), tn, nFade * 0.85));
            vec3 wN = normalize(vWNormal);
            vec3 wT = normalize(cross(vec3(0.0, 0.0, 1.0), wN));
            vec3 wB = cross(wN, wT);
            vec3 wNormal = normalize(wT * tn.x + wB * tn.y + wN * tn.z);
            normal = normalize((viewMatrix * vec4(wNormal, 0.0)).xyz);
          }
        }`);

    // 讓 three 在材質更新時重新編譯
    mat.userData.shader = shader;
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
