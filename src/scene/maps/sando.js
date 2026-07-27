// 參道 —— 分圖改造的第二張圖，也是第一張「舊世界裡不存在」的圖。
//
// 博麗神社的石段往下延伸出去的那段長坡。舊世界沒有這塊地：那一帶
// 實測是側傾的山坡（橫向 100m 內落差 57m），直接切出來會走得很怪。
// 所以這張圖有**自己的高度場** —— 這正是分圖真正的價值：
// 地區之間終於能有「路」，而不是硬把地形壓平。
//
// 座標系：局部座標，原點在參道正中。z 負向朝神社（上坡），z 正向朝山下。
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, buildTerrainSkirt, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField } from '../../world/vegetation.js';
import { makeTorii, makeLantern, initMats } from '../../world/structures.js';
import { mergeStaticByMaterial } from '../../core/optimize.js';
import { fbm } from '../../core/noise.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.shrine;

const LEN = 600;          // 沿 z 的長度
const WIDTH = 200;        // 沿 x 的寬度
const TOP_H = 57.6;       // 神社端的高度（＝石段底、shrine 圖 z=-150 的實測值）
const BOTTOM_H = 26;      // 山下端
const PATH_HALF = 7;      // 石板路半寬

export const meta = {
  id: 'sando',
  zh: '參道',
  en: 'SANDO — THE APPROACH',
  size: LEN,
  sizeX: WIDTH,
  sizeZ: LEN,
  spawn: { x: 0, z: 0, facing: Math.PI },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
  // 自己造地形的圖：世界座標對它沒有意義，所以必須自己提供
  // 邊緣過渡帶（skirtHeightAt），否則裙襬會跟自己的地形對不上（規格書 §1）。
  heightSpace: 'local',
};

export const entries = {
  // 從神社下來 —— 站在參道頂端，面向山下
  from_shrine: { x: 0, z: -262, facing: 0 },
  // 從里上來 —— 站在參道底端，面向山上
  from_village: { x: 0, z: 262, facing: Math.PI },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'sando_to_shrine',
    to: 'shrine',
    entry: 'from_sando',
    trigger: { x: 0, z: -292, r: 10 },
    label: '往博麗神社',
    style: 'walk',
    condition: null,
  },
  {
    id: 'sando_to_village',
    to: 'village',
    entry: 'from_sando',
    trigger: { x: 0, z: 292, r: 10 },
    label: '往人間之里',
    style: 'walk',
    condition: null,
  },
];

/**
 * 參道自己的地形：中央一條緩降的路，兩側抬起成谷壁。
 * 谷壁不是為了好看 —— 它是這張圖的邊界，讓玩家自然留在路上。
 */
export function heightAt(x, z) {
  const t = (z + LEN / 2) / LEN;                      // 0 = 神社端, 1 = 山下端
  let h = TOP_H + (BOTTOM_H - TOP_H) * Math.min(1, Math.max(0, t));
  // 谷壁：離中線越遠抬得越快（二次），到圖邊約 +40m
  const d = Math.abs(x) / (WIDTH / 2);
  h += d * d * 40;
  // 路面之外才加起伏，石板路本身保持平整好走
  const rough = Math.min(1, Math.max(0, (Math.abs(x) - PATH_HALF) / 12));
  h += fbm(x * 0.02, z * 0.02, 3) * 2.2 * rough;
  return h;
}

/**
 * 裙襬用的高度：從這張圖自己的地形，平滑過渡到舊世界的地貌。
 *
 * `heightSpace: 'local'` 的圖必須提供這個（契約的一部分）。不做過渡的話，
 * 自己的谷壁跟遠景的世界地形在圖邊會對不上，接縫處出現斷崖。
 * 白玉樓、天界、彼岸之後也都會走這條路。
 */
export function skirtHeightAt(x, z) {
  const own = heightAt(x, z);
  // 用世界座標取樣舊世界（參道的世界位置就是它在山坡上的那一段）
  const world = terrainHeight(x + R.x, z + (R.z - 475));
  // 從圖邊界往外 240 公尺之內完成過渡
  const d = Math.max(Math.abs(x) / (WIDTH / 2), Math.abs(z) / (LEN / 2));
  const k = Math.min(1, Math.max(0, (d - 1) / 1.2));
  const t = k * k * (3 - 2 * k);            // smoothstep
  return own * (1 - t) + world * t;
}

/** 石板路上不長樹也不長草 */
function plantableHere(x, z) {
  if (Math.abs(x) < PATH_HALF + 2.5) return false;
  if (Math.abs(x) > WIDTH / 2 - 6) return false;      // 圖邊留白
  return true;
}

export async function build(ctx) {
  const { quality: q, progress } = ctx;
  const group = new THREE.Group();
  group.name = 'map:sando';
  const colliders = [];
  const lanterns = [];
  const props = new THREE.Group();     // 靜態陳設（鳥居、石燈籠），最後整組合併
  props.name = 'sando-props';
  // 鳥居與石燈籠用的是 structures.js 的共用材質庫。這張圖沒有走
  // buildStructureSet，得自己確保材質已經建好。
  initMats();

  await progress?.(25, '鋪開參道長坡…');
  const seg = Math.max(48, Math.min(256, Math.round(LEN / 4)));
  const terrain = buildTerrain(seg, {
    sizeX: WIDTH, sizeZ: LEN, ox: R.x, oz: R.z - 475,
  });
  // buildTerrain 是照世界高度場塑形的（它服務舊世界）。這張圖有自己的
  // 地形，所以塑形完直接把 Y 換成 heightAt —— 著色與 splat 權重仍沿用
  // 神社一帶的取樣，色調才跟山上接得起來。
  {
    const pos = terrain.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    }
    pos.needsUpdate = true;
    terrain.geometry.computeVertexNormals();
  }
  group.add(terrain);

  // 遠景裙襬。這張圖是 local 高度場，所以餵的是自己的過渡函式，
  // 而不是世界高度場 —— 直接用世界的會在圖邊斷開。
  group.add(buildTerrainSkirt({ x: WIDTH / 2, z: LEN / 2 }, 1100, skirtHeightAt));

  // 這張圖自己的除草區（局部座標）：石板路上不長草。
  // clearings 現在是每張圖一份，manager 載圖時換上 —— 不會再污染舊世界。
  const clearings = [{ x: 0, z: 0, hw: PATH_HALF + 2, hd: LEN / 2 }];

  // --- 鳥居：頂端一座、中段一座 ---------------------------------------
  for (const [z, s] of [[-250, 1.2], [40, 1.0]]) {
    const t = makeTorii(s);
    t.position.set(0, heightAt(0, z), z);
    props.add(t);
    const W = 5.4 * s / 2;
    for (const sx of [-1, 1]) {
      colliders.push({ x: sx * W, z, r: 0.4 * s, y: heightAt(0, z), h: 7 * s });
    }
  }

  // --- 石燈籠列：兩側等距，夜裡是唯一的光 -----------------------------
  await progress?.(60, '點起石燈籠…');
  for (let z = -270; z <= 270; z += 30) {
    for (const sx of [-1, 1]) {
      const lx = sx * (PATH_HALF + 2.2);
      const ly = heightAt(lx, z);
      const L = makeLantern(0.95);
      L.position.set(lx, ly, z);
      props.add(L);
      lanterns.push({ obj: L, x: lx, y: ly + 1.8, z, color: 0xffb066, power: 4.5 });
    }
  }

  // --- 兩側杉木 --------------------------------------------------------
  await progress?.(75, '立起杉木…');
  const vegetation = buildVegetation(Math.round(q.trees * 0.12), {
    cx: 0, cz: 0, halfX: WIDTH / 2, halfZ: LEN / 2,
    heightFn: heightAt,
    plantableFn: plantableHere,
    speciesFn: () => 'cedar',        // 參道兩側是杉並木，不混其他樹種
  });
  group.add(vegetation);

  // 鳥居與燈籠全是靜態的 —— 依材質合併成少數大網格。
  // 「draw call 才是瓶頸，不是三角形」是這個專案的核心心法，新圖照辦。
  mergeStaticByMaterial(props);
  group.add(props);

  await progress?.(88, '鋪上草原…');
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.45)) : null;
  if (grass) group.add(grass.mesh);

  const atmosphere = new Atmosphere(0, Math.round(q.mist * 0.4));
  group.add(atmosphere.group);

  return {
    group,
    heightAt,
    origin: { x: R.x, z: R.z - 475 },
    colliders,
    lanterns,
    staticLights: [],
    interactives: [],
    clearings,
    portals,
    npcs: [],
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
      group.removeFromParent();
    },
  };
}
