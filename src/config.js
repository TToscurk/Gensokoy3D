// 畫質預設 —— 針對 GTX 1070 / i7-9700 / 16GB 調校
//
// 測試基準：1920x1080 視窗，目標 60fps。
// 'high' 是 1070 的甜蜜點；'ultra' 大約會掉到 40~50fps。

export const QUALITY = {
  low: {
    label: '低',
    pixelRatio: 0.75,
    shadow: 0,            // 0 = 關閉陰影
    shadowExtent: 100,
    bloom: false,
    smaa: false,
    trees: 700,
    grass: 4000,
    petals: 300,
    viewDist: 900,
    terrainSeg: 200,
    waterReflect: false,
    anisotropy: 2,
    ao: false,
    clouds: 0,
    mist: 0,
  },
  medium: {
    label: '中',
    pixelRatio: 1.0,
    shadow: 2048,
    shadowExtent: 140,
    bloom: true,
    smaa: false,
    trees: 1500,
    grass: 14000,
    petals: 800,
    viewDist: 1500,
    terrainSeg: 320,
    waterReflect: false,
    anisotropy: 4,
    ao: true,
    clouds: 24,
    mist: 24,
  },
  high: {
    label: '高',
    pixelRatio: 1.0,
    shadow: 4096,
    shadowExtent: 190,
    bloom: true,
    smaa: true,
    trees: 2800,
    grass: 26000,
    petals: 1600,
    viewDist: 2200,
    terrainSeg: 448,
    waterReflect: true,
    anisotropy: 8,
    ao: true,
    clouds: 40,
    mist: 48,
  },
  ultra: {
    label: '極致',
    pixelRatio: 1.25,
    shadow: 4096,
    shadowExtent: 250,
    bloom: true,
    smaa: true,
    trees: 4400,
    grass: 48000,
    petals: 2600,
    viewDist: 3000,
    terrainSeg: 576,
    waterReflect: true,
    anisotropy: 16,
    ao: true,
    clouds: 56,
    mist: 64,
  },
};

// 目標機器換成筆電內顯（Intel Iris Xe / i5-1335U）—— 預設降到 'low'。
// 桌機（GTX 1070）的甜蜜點仍是 'high'，設定面板隨時可以切回去。
export const DEFAULT_QUALITY = 'low';

// ---------------------------------------------------------------------------
// 世界尺度與方位
// ---------------------------------------------------------------------------
// 座標約定：  +X = 東    -X = 西    -Z = 北    +Z = 南
// 這與從上空俯視、北方朝上的地圖一致。

export const WORLD = {
  size: 2400,
  waterLevel: 0,
  gravity: -26,
};

export const COMPASS = [
  { a: 0,           zh: '北', en: 'N' },
  { a: Math.PI / 4, zh: '東北', en: 'NE' },
  { a: Math.PI / 2, zh: '東', en: 'E' },
  { a: Math.PI * 0.75, zh: '東南', en: 'SE' },
  { a: Math.PI,     zh: '南', en: 'S' },
  { a: Math.PI * 1.25, zh: '西南', en: 'SW' },
  { a: Math.PI * 1.5, zh: '西', en: 'W' },
  { a: Math.PI * 1.75, zh: '西北', en: 'NW' },
];

// ---------------------------------------------------------------------------
// 地區
// ---------------------------------------------------------------------------
// 方位依原作設定與同人考據整理（詳見 README 的「地理依據」）：
//
//   ・博麗神社 —— 幻想鄉「東の端」，位於博麗大結界線上的遠方山中
//   ・妖怪之山 —— 幻想鄉最大的山；山麓有霧之湖，山頂近湖處為守矢神社
//   ・紅魔館   —— 霧之湖畔
//   ・迷途竹林 —— 從人間之里看，位於妖怪之山的「正反方向」，
//                 且在魔法之森「更後方」；永遠亭在竹林之中
//   ・無名之丘 / 太陽花田 —— 同樣在妖怪之山的反方向
//   ・香霖堂   —— 人間之里與魔法之森之間
//
// peak: true 的地區會在地形上「疊加」一座山，而不是壓平成台地。
// 陣列順序有意義：山要排在建在它身上的台地之前。

export const REGIONS = [
  // ---- 西北：妖怪之山系 ----
  // peak: true 的地區會疊出一座真正的火山錐（terrain.js 讀 peakH/craterR/
  // craterDepth/rimH），elev 是「山腳台地」高度，峰頂 ≈ elev + peakH。
  {
    id: 'youkaiMountain', zh: '妖怪之山', en: 'YOUKAI MOUNTAIN', dir: '西北',
    x: -640, z: -690, elev: 150, radius: 360, rough: 26, peak: true,
    peakH: 225, craterR: 56, craterDepth: 26, rimH: 26,
    fog: 0x8fa4b4, accent: 0x6f8fbf, warp: [-408, -536],
  },
  // 守矢神社：考據上位於「接近山頂的風神湖湖畔」——放在火口湖東南緣，
  // 比湖面（342）高約 10m 的火山口緣平台上，俯視湖面。
  {
    id: 'moriya', zh: '守矢神社', en: 'MORIYA SHRINE', dir: '西北',
    x: -598, z: -648, elev: 352, radius: 62, rough: 1.2,
    fog: 0xbcd0e4, accent: 0x3f8fc2,
  },
  {
    id: 'lake', zh: '霧之湖', en: 'MISTY LAKE', dir: '北西',
    x: -430, z: -400, elev: -14, radius: 195, rough: 1.0,
    fog: 0xc3d6e2, accent: 0x8fd8ee,
  },
  {
    id: 'sdm', zh: '紅魔館', en: 'SCARLET DEVIL MANSION', dir: '西北',
    x: -700, z: -270, elev: 36, radius: 175, rough: 1.2,
    fog: 0xb08088, accent: 0xd0263a,
  },

  // ---- 東：博麗神社（結界線上） ----
  {
    id: 'shrine', zh: '博麗神社', en: 'HAKUREI SHRINE', dir: '東',
    x: 855, z: -175, elev: 104, radius: 185, rough: 1.6,
    fog: 0x9fb4cc, accent: 0xc2382f,
  },

  // ---- 中央 ----
  {
    id: 'village', zh: '人間之里', en: 'HUMAN VILLAGE', dir: '中央',
    x: -80, z: 150, elev: 15, radius: 205, rough: 0.8,
    fog: 0xb8c4d0, accent: 0xd9b26a,
  },
  {
    id: 'myouren', zh: '命蓮寺', en: 'MYOUREN TEMPLE', dir: '西',
    x: -455, z: 70, elev: 28, radius: 120, rough: 1.2,
    fog: 0xc8bcd8, accent: 0xb98fd8,
  },
  {
    id: 'kourindou', zh: '香霖堂', en: 'KOURINDOU', dir: '西南',
    x: -235, z: 340, elev: 19, radius: 82, rough: 1.0,
    fog: 0xc4bca8, accent: 0x8a7a5a,
  },

  // ---- 西南～南：魔法之森與其後方的竹林 ----
  {
    id: 'forest', zh: '魔法之森', en: 'FOREST OF MAGIC', dir: '西南',
    x: -420, z: 570, elev: 26, radius: 250, rough: 6.5,
    fog: 0x4a5f4c, accent: 0x7dd88a,
  },
  {
    id: 'muenzuka', zh: '無緣塚', en: 'MUENZUKA', dir: '西南',
    x: -640, z: 760, elev: 22, radius: 95, rough: 2.4,
    fog: 0x7a6f80, accent: 0xc890d8,
  },
  {
    id: 'bamboo', zh: '迷途竹林', en: 'BAMBOO FOREST OF THE LOST', dir: '南',
    x: -60, z: 840, elev: 17, radius: 235, rough: 3.0,
    fog: 0x8fae86, accent: 0xa8c96a,
  },

  // ---- 東南：山的反方向 ----
  {
    id: 'namelessHill', zh: '無名之丘', en: 'NAMELESS HILL', dir: '東南',
    x: 430, z: 640, elev: 68, radius: 175, rough: 5.0,
    fog: 0xc8d4b8, accent: 0xd8e8a0,
  },
  {
    id: 'sunflower', zh: '太陽花田', en: 'GARDEN OF THE SUN', dir: '東南',
    x: 660, z: 330, elev: 32, radius: 200, rough: 1.4,
    fog: 0xe4d090, accent: 0xf2c832,
  },

  // ---- 妖怪之山：天狗聚落（山腰的木造聚落，非山頂的守矢神社） ----
  {
    id: 'tenguVillage', zh: '天狗聚落', en: 'TENGU SETTLEMENT', dir: '西北',
    x: -840, z: -590, elev: 142, radius: 78, rough: 3.2,
    fog: 0xa8bcce, accent: 0x8a9ab0,
  },

  // ---- 結界之外 ----
  {
    id: 'netherworld', zh: '白玉樓', en: 'HAKUGYOKUROU', dir: '結界之外', remote: true,
    x: 620, z: -760, elev: 168, radius: 190, rough: 2.0,
    fog: 0xe6c2d4, accent: 0xf2a8c4,
  },
  {
    id: 'tenkai', zh: '天界', en: 'BHAVA-AGRA', dir: '天空', remote: true,
    x: 350, z: -880, elev: 340, radius: 130, rough: 1.2,
    fog: 0xdce8f4, accent: 0xf4d8b0,
  },
  {
    id: 'higan', zh: '彼岸', en: 'HIGAN', dir: '結界之外', remote: true,
    x: 950, z: -550, elev: -6, radius: 150, rough: 1.6,
    fog: 0x9098a4, accent: 0xd8305a,
  },
];

export const REGION_BY_ID = Object.fromEntries(REGIONS.map(r => [r.id, r]));

// ---------------------------------------------------------------------------
// 風神湖（山頂火口湖）與山溪河道
// ---------------------------------------------------------------------------
// terrain.js 壓湖床/切河道、water.js 鋪水面、structures.js 蓋湖畔建築都讀這裡。
// 河床測站沿線單調遞減，保證全程下坡；瀑布段就是落差最大的那一節。
export const CRATER_LAKE = { x: -640, z: -690, r: 48, bed: 334, waterY: 342 };

// [x, z, 河床高]：溢流口 → 九天瀑布 → 山溪 → 霧之湖北緣
export const RIVER = [
  [-652, -682, 340],   // 溢流口（湖內緣，略低於水面 342 形成出水口）
  [-712, -650, 300],
  [-792, -618, 210],
  [-852, -600, 172],   // 九天瀑布上緣
  [-866, -592, 140],   // 九天瀑布下緣（落差 ~32，接瀑布建築位置）
  [-820, -520, 70],
  [-700, -460, 20],
  [-560, -420, 4],
  [-498, -406, -4],    // 霧之湖北緣收口
];

/** 傳送選單要列出的地點（略過純地形的山體本身） */
export const WARP_POINTS = REGIONS.filter(r => r.id !== 'youkaiMountain' || r.warp);
