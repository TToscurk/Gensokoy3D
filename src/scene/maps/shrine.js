// 博麗神社 —— 分圖改造的第一張真圖（SCENE_MANAGER_SPEC §2 階段 2）。
//
// 座標系：**局部座標，原點在神社中心**。地貌仍照世界座標取樣，
// 所以這張圖的地形、著色、樹種跟舊世界的同一塊地完全對得上 ——
// 換的是「世界是怎麼被載入的」，不是世界長什麼樣。
//
// 高度（Y）一律是世界絕對高度，沿用 structures.js 的慣例（〈坑〉第 3 條）。
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, buildTerrainSkirt, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField, setClearings } from '../../world/vegetation.js';
import { buildStructureSet } from '../../world/structures.js';
import { mergeStaticByMaterial } from '../../core/optimize.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.shrine;

/** 這張圖的中心在世界座標的哪裡 —— 局部 ↔ 世界的唯一換算來源。 */
export const ORIGIN = { x: R.x, z: R.z };

export const meta = {
  id: 'shrine',
  zh: '博麗神社',
  en: 'HAKUREI SHRINE',
  size: 480,
  spawn: { x: 0, z: 60, facing: Math.PI },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
  // 從舊世界的高度場切出來的圖：遠景裙襬直接續用同一個高度場，
  // 天際線會是地理上真的那片地貌（規格書 §1）。
  heightSpace: 'world',
};

export const entries = {
  // 從參道上來 —— 站在石段頂端的大鳥居下，面向社殿
  from_sando: { x: 0, z: -84, facing: 0 },
  // 從太陽花田過來 —— 站在神社的南緣
  from_sunflower: { x: -56, z: 152, facing: Math.PI * -0.2 },
  // 從白玉樓回來 —— 落在西坡的結界之門外，回頭就是上山的坡道
  from_netherworld: { x: -126, z: 34, facing: Math.PI * -0.55 },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'shrine_to_sando',
    to: 'sando',
    entry: 'from_shrine',
    // 石段起點：越過這裡就是走下參道
    trigger: { x: 0, z: -150, r: 9 },
    label: '往參道',
    style: 'walk',
    condition: null,
  },
  {
    id: 'shrine_to_sunflower',
    to: 'sunflower',
    entry: 'from_shrine',
    // 南緣：神社後方往山反方向的緩坡，盡頭是太陽花田
    trigger: { x: -72, z: 186, r: 10 },
    label: '往太陽花田',
    style: 'walk',
    condition: null,
  },
  {
    id: 'shrine_to_netherworld',
    to: 'netherworld',
    entry: 'from_shrine',
    // 西坡下方的結界之門 —— 大結界最薄的一線，紫來去冥界走的路。
    // 坡面實測平緩（46m → 平台 104m 是一段連續的坡道）
    trigger: { x: -150, z: 40, r: 7 },
    label: '結界之門（往白玉樓）',
    style: 'gate',
    condition: null,
  },
];

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function angleDiff(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

// 東側（結界之外，三個出口都不在這個方位）疊加漸強的地形抬升，
// 做出「走不到的地方是懸崖」的視覺封閉，取代原本開闊到底其實是空氣的處理。
// 方位角直接從 portals 的觸發點算，不寫死角度——出入口調整位置時這裡自動跟著避開。
const PORTAL_BEARINGS = portals.map(p => Math.atan2(p.trigger.x, p.trigger.z));
const WALL_BEARING = Math.PI / 2;          // +X＝東（config.js 座標約定）
const WALL_HALF_ARC = 55 * Math.PI / 180;

function bearingGate(x, z) {
  const b = Math.atan2(x, z);
  let gate = 1 - smoothstep(0, WALL_HALF_ARC, angleDiff(b, WALL_BEARING));
  for (const pb of PORTAL_BEARINGS) {
    gate *= smoothstep(18 * Math.PI / 180, 32 * Math.PI / 180, angleDiff(b, pb));
  }
  return gate;
}

/** 這張圖的地形高度場：局部座標進、世界高度出。
 *  東側方位在半徑 170（安全避開建築 collider 與植被核心排除區）到 225
 *  （略小於 half=240，留一圈緩衝）之間陡升約 140m——只是視覺，玩家真正的
 *  邊界仍是 meta.size 換算出的空氣牆（main.js applyEnv）。這裡只是讓那道
 *  看不見的牆長得像一面真的懸崖；陡坡處 groundSample() 既有的岩石貼圖判斷
 *  會自動套用，不用另外處理貼圖。
 *  抬升量刻意抓比境內台地（elev≈104）高出許多——實測東側方位的原始地形
 *  是一片窪地（最低約 43），只抬到跟台地齊平的話從境內看只是一片緩坡，
 *  讀不出「這裡是懸崖」，所以要蓋過台地高度、讓它在天際線上真的凸出來。 */
export function heightAt(x, z) {
  const base = terrainHeight(x + ORIGIN.x, z + ORIGIN.z);
  const d = Math.hypot(x, z);
  const radial = smoothstep(170, 225, d);
  return base + radial * bearingGate(x, z) * 140;
}

export async function build(ctx) {
  const { quality: q, progress } = ctx;
  const group = new THREE.Group();
  group.name = 'map:shrine';

  // --- 地形 ---------------------------------------------------------------
  // 小圖負擔得起比舊世界細的網格：舊世界是 2400/terrainSeg（低畫質約 12m
  // 一格），這裡固定約 4m 一格，格數卻只有原本的一小部分。
  await progress?.(20, '隆起神社台地…');
  const seg = Math.max(48, Math.min(256, Math.round(meta.size / 4)));
  const terrain = buildTerrain(seg, { size: meta.size, ox: ORIGIN.x, oz: ORIGIN.z });
  group.add(terrain);

  // 遠景裙襬：地形之外一圈低解析度背景，延伸到霧之外，
  // 免得地圖邊緣被切出硬邊（1 個 draw call）。
  const skirt = buildTerrainSkirt(meta.size / 2, 1100, heightAt);
  group.add(skirt);

  // --- 建築 ---------------------------------------------------------------
  // 一定要排在植被之前：buildShrine 會登記除草區（參道、境內），
  // 植被的 plantable() 讀的就是那份清單，順序反了會長草在石階上。
  await progress?.(45, '重建拜殿與鳥居…');
  const st = buildStructureSet(['shrine']);
  // builder 產出的一切都在世界座標，整組平移回這張圖的原點
  // 建築完全靜態 —— 依材質合併成少數大網格，跟舊世界同一套心法。
  // 必須在平移之前做：合併會把世界矩陣烘進頂點。
  mergeStaticByMaterial(st.root, ['clock-hands', 'rope-cabin']);
  st.root.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(st.root);

  const toLocal = o => ({ ...o, x: o.x - ORIGIN.x, z: o.z - ORIGIN.z });
  const colliders = st.colliders.map(toLocal);
  // 除草區也要換算 —— 記錯座標系的話草會長在石階上、真正的空地卻是禿的
  const clearings = st.clearings.map(toLocal);
  const lanterns = st.lights.map(toLocal);
  const staticLights = st.staticLights.map(l => {
    l.position.x -= ORIGIN.x;
    l.position.z -= ORIGIN.z;
    return l;
  });
  const interactives = [];
  for (const inr of st.interiors) {
    const e = toLocal(inr.enter), ins = toLocal(inr.inside), ex = toLocal(inr.exit);
    interactives.push({
      id: inr.id + ':enter', label: `進入${inr.zh}`,
      x: e.x, z: e.z, y: e.y,
      to: { x: ins.x, z: ins.z, y: ins.y }, zh: inr.zh, msg: '推門而入…',
    });
    interactives.push({
      id: inr.id + ':exit', label: `離開${inr.zh}`,
      x: ins.x, z: ins.z, y: ins.y,
      to: { x: ex.x, z: ex.z, y: ex.y }, zh: inr.zh, msg: '回到戶外…',
    });
  }

  // --- 植被 ---------------------------------------------------------------
  await progress?.(65, '種下杉木與楓…');
  // 樹只要這一帶的。沿用舊世界密度公式的話，480×480 只分得到約 33 棵，
  // 散在整張圖幾乎看不到——舊世界密度是給「大片荒野」用的基準，神社是
  // 使用者想要有內容感的展示圖，密度另外加乘（2026-07 使用者要求）。
  const density = 4 * q.trees / (2400 * 0.92) ** 2;
  const trees = Math.round(density * meta.size ** 2);
  // 植被的 plantable() 讀「現行除草區清單」。這張圖的除草區是世界座標
  // （還沒換算前的 st.clearings），而下種也在世界座標，兩邊一致。
  setClearings(st.clearings);
  const vegetation = buildVegetation(trees, {
    cx: ORIGIN.x, cz: ORIGIN.z, half: meta.size / 2,
  });
  setClearings(null);
  vegetation.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(vegetation);

  await progress?.(80, '鋪上草原…');
  // GrassField 是以玩家為中心的滾動磚格，本來就跟圖的大小無關；
  // 它吃 groundHeight()，manager 一換高度場就自動跟著這張圖。
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.6)) : null;
  if (grass) group.add(grass.mesh);

  await progress?.(92, '織起霧帶…');
  const atmosphere = new Atmosphere(Math.round(q.clouds * 0.5), Math.round(q.mist * 0.5));
  group.add(atmosphere.group);

  return {
    group,
    heightAt,
    origin: ORIGIN,
    colliders,
    lanterns,
    staticLights,
    interactives,
    clearings,
    portals,
    // 住在這張圖上的人（roster 的 region 欄位說了算）。
    // 不要寫別區的住民 —— 他們的座標會被換算成離譜的地方。
    npcs: ['reimu', 'yukari'],
    mobs: [],
    terrain, vegetation, grass, atmosphere,

    update(dt, t, rt) {
      atmosphere?.update(t, rt.sky, rt.nightFactor);
      if (grass) {
        grass.update(rt.playerPos);
        const gsh = grass.mesh.material.userData.shader;
        if (gsh) gsh.uniforms.uTime.value = t;
      }
    },

    dispose() {
      group.traverse(o => {
        if (o.isMesh || o.isPoints) {
          o.geometry?.dispose();
          const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
          for (const m of mats) m.dispose();
        }
      });
      // 共用資源（PBR 貼圖、草葉圖集、樹皮、toon 材質）不在這裡釋放 ——
      // 它們跨圖重用，誤 dispose 會讓下一張圖整片變黑（規格書 §3）。
      group.removeFromParent();
    },
  };
}
