// 參道 —— 神社與人間之里之間的連接圖，2026-07 重做。
//
// 舊版是「舊世界那道側傾山坡」切出來的一條直線谷地，靠世界座標
// （REGION_BY_ID.shrine 的位置）決定裙襬要接哪一片舊地形。這次使用者
// 要求：不要再繫於任何舊世界座標，地形完全自己設計；圖邊也不准再出現
// 破口或透明穿幫——邊界外的景色要自己延伸出去，不能靠取樣舊世界頂著。
//
// 於是這版參道是一條完全自己想像出來的森林山徑：中段蜿蜒成一個緩 S 彎
// （不是直線谷地），兩端各留一小段直線銜接神社／村莊的出入口，保持
// 「連接角色」——trigger／entry 座標跟舊版完全一樣，只換內部怎麼造。
// 裙襬不再取樣 terrainHeight()，而是把自己的地勢往外延伸、逐漸抬升成
// 一圈遠山，從任何角度看出去都是連續的地表，不會露出圖外的空氣。
//
// 座標系：局部座標，原點在參道正中。z 負向朝神社（上坡），z 正向朝里下山。
import * as THREE from 'three';
import { fbm, smoothstep, lerp, clamp } from '../../core/noise.js';
import { buildTerrain, buildTerrainSkirt, groundSample } from '../../world/terrain.js';
import { buildVegetation, GrassField } from '../../world/vegetation.js';
import { makeTorii, makeLantern, initMats } from '../../world/structures.js';
import { mergeStaticByMaterial } from '../../core/optimize.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const LEN = 600;          // 沿 z 的長度
const WIDTH = 200;        // 沿 x 的寬度
// 兩端高度不是憑空定的：分別實測神社「往參道」傳送點（shrine.js heightAt(0,-150)
// ≈40.7）與人間之里「往參道」傳送點（terrainHeight 於村里北緣 ≈11.1）算出來，
// 讓玩家跨圖時腳下高度銜接得上，不會憑空掉落或卡進地形。
const TOP_H = 40.7;       // 神社端
const BOTTOM_H = 11.1;    // 里端
const PATH_HALF = 7;      // 石板路半寬
const BEND_AMP = 26;      // S 彎的最大側移
// 進出口兩端各留一段直線（呼應 trigger 落在這一段內，路面不能是斜的彎道）
const T_ENTRY_SHRINE = (-262 + LEN / 2) / LEN;   // entries.from_shrine 對應的 t
const T_ENTRY_VILLAGE = (262 + LEN / 2) / LEN;   // entries.from_village 對應的 t
const T_BEND_IN = 0.2, T_BEND_OUT = 0.8;         // 彎道全幅段的範圍

export const meta = {
  id: 'sando',
  zh: '參道',
  en: 'SANDO — THE APPROACH',
  size: LEN,
  sizeX: WIDTH,
  sizeZ: LEN,
  spawn: { x: 0, z: 0, facing: Math.PI },
  // 不再借用神社的 fog/accent——這張圖自己的森林山徑，自己配色：
  // 冷灰藍霧襯山徑，暖琥珀呼應沿路石燈籠的光。
  fog: 0xaab6c4,
  accent: 0xd98a3d,
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
 * 路徑中心線：兩端各一段直線（涵蓋 trigger／entry，路面不能是斜的），
 * 中段緩緩甩出一個 S 彎——完全自己想像的路線，不是舊世界切出來的直谷。
 */
function laneX(z) {
  const t = clamp((z + LEN / 2) / LEN, 0, 1);
  const edge = smoothstep(T_ENTRY_SHRINE, T_BEND_IN, t) * (1 - smoothstep(T_BEND_OUT, T_ENTRY_VILLAGE, t));
  return Math.sin(t * Math.PI * 3.1) * BEND_AMP * edge;
}

/**
 * 參道自己的地形：沿中心線緩降的路，兩側抬起成谷壁。
 * 谷壁不是為了好看 —— 它是這張圖的邊界，讓玩家自然留在路上。
 */
export function heightAt(x, z) {
  const t = clamp((z + LEN / 2) / LEN, 0, 1);
  // 用 smoothstep（而不是線性）沿全長降完，兩端的坡度自然趨緩到接近平——
  // 算出來在 entries 兩點的高度剛好貼近 TOP_H/BOTTOM_H 本身，交接處不會有台階感。
  let h = lerp(TOP_H, BOTTOM_H, smoothstep(0, 1, t));
  const lane = laneX(z);
  // 谷壁：離中心線越遠抬得越快（二次），到谷壁頂約 +40m
  const d = Math.abs(x - lane) / (WIDTH / 2);
  h += d * d * 40;
  // 路面之外才加起伏，石板路本身保持平整好走
  const rough = clamp((Math.abs(x - lane) - PATH_HALF) / 12, 0, 1);
  h += fbm(x * 0.02, z * 0.02, 3) * 2.4 * rough;
  return h;
}

const FAR_H = 150;  // 遠山基準高度：比參道谷地本身（11~41）高得多，確保四面都能被擋住

/**
 * 裙襬用的高度：完全不取樣舊世界地形——使用者明確要求不要再繫於舊世界座標。
 * 從這張圖自己的邊界往外，把自己的地勢延伸並逐漸抬升封頂成一圈遠山，
 * 確保鏡頭無論轉到哪個角度，圖邊外側永遠是連續地表，不會露出破口。
 */
export function skirtHeightAt(x, z) {
  const own = heightAt(x, z);
  const d = Math.max(Math.abs(x) / (WIDTH / 2), Math.abs(z) / (LEN / 2));
  const t = smoothstep(1.0, 1.6, d);
  const far = FAR_H + fbm(x * 0.01 + 40, z * 0.01 - 40, 3) * 26;
  return lerp(own, far, t);
}

/** 石板路上不長樹也不長草 */
function plantableHere(x, z) {
  const lane = laneX(z);
  if (Math.abs(x - lane) < PATH_HALF + 2.5) return false;
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
  const terrain = buildTerrain(seg, { sizeX: WIDTH, sizeZ: LEN });
  // buildTerrain 是照世界高度場的邏輯塑形/上色的。這張圖有自己的地形，
  // 塑形完直接把 Y 換成 heightAt，並用新的坡度重新烘一次頂點色／splat
  // 權重（比照 shrine.js 的修法）——不然彎道的谷壁陡坡會套著沒有細節的
  // 純草地色，看起來像一片死板色塊。
  {
    const pos = terrain.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    }
    pos.needsUpdate = true;
    terrain.geometry.computeVertexNormals();

    const nrm = terrain.geometry.attributes.normal;
    const colorAttr = terrain.geometry.attributes.color;
    const splatAAttr = terrain.geometry.attributes.aSplatA;
    const splatBAttr = terrain.geometry.attributes.aSplatB;
    const _col = new THREE.Color(); const _a4 = [0, 0, 0, 0]; const _b2 = [0, 0];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
      const slope = 1 - nrm.getY(i);
      // groundSample 原本是照世界座標判斷地區貼圖的。這張圖的局部座標
      // 範圍（x±100／z±300）剛好會蓋到世界座標 (0,0) 附近，若直接原樣丟
      // 進去，會意外落進人間之里（世界座標 -80,150）的地區混色範圍——
      // 又繞回「繫於舊世界座標」。固定加一個遠離所有地區／湖泊的偏移量，
      // 保證這裡永遠只拿到通用的草地／森林／岩壁混色（純看坡度與噪聲），
      // 不會被任何真實地區的貼圖分支影響。
      groundSample(x + 5000, z + 5000, h, slope, _col, _a4, _b2);
      colorAttr.setXYZ(i, _col.r, _col.g, _col.b);
      splatAAttr.setXYZW(i, _a4[0], _a4[1], _a4[2], _a4[3]);
      splatBAttr.setXYZW(i, _b2[0], _b2[1], 0, 0);
    }
    colorAttr.needsUpdate = true;
    splatAAttr.needsUpdate = true;
    splatBAttr.needsUpdate = true;
  }
  group.add(terrain);

  // 遠景裙襬：餵自己的過渡函式（見 skirtHeightAt），不取樣世界地形。
  group.add(buildTerrainSkirt({ x: WIDTH / 2, z: LEN / 2 }, 1100, skirtHeightAt));

  // 這張圖自己的除草區（局部座標）：沿彎道分段跟著中心線走，
  // 一整條直的方框蓋不住彎道，所以每 20 公尺放一段、彼此重疊。
  const clearings = [];
  for (let z = -LEN / 2; z <= LEN / 2; z += 20) {
    clearings.push({ x: laneX(z), z, hw: PATH_HALF + 2.5, hd: 12 });
  }

  // --- 鳥居：兩端各一座，立在彎道之前的直線段（方位不用跟著彎道轉） ---
  for (const z of [-245, 245]) {
    const t = makeTorii(1.15);
    t.position.set(laneX(z), heightAt(laneX(z), z), z);
    props.add(t);
    const W = 5.4 * 1.15 / 2;
    for (const sx of [-1, 1]) {
      colliders.push({ x: laneX(z) + sx * W, z, r: 0.46, y: heightAt(laneX(z), z), h: 8 });
    }
  }

  // --- 石燈籠列：沿彎道兩側等距，夜裡是唯一的光 -----------------------
  await progress?.(60, '點起石燈籠…');
  for (let z = -270; z <= 270; z += 24) {
    const lane = laneX(z);
    for (const sx of [-1, 1]) {
      const lx = lane + sx * (PATH_HALF + 2.2);
      const ly = heightAt(lx, z);
      const L = makeLantern(0.95);
      L.position.set(lx, ly, z);
      props.add(L);
      lanterns.push({ obj: L, x: lx, y: ly + 1.8, z, color: 0xffb066, power: 4.5 });
    }
  }

  // --- 兩側杉楓混林（不再是單一杉並木，多一點樹種變化）----------------
  await progress?.(75, '立起杉楓混林…');
  const vegetation = buildVegetation(Math.round(q.trees * 0.14), {
    cx: 0, cz: 0, halfX: WIDTH / 2, halfZ: LEN / 2,
    heightFn: heightAt,
    plantableFn: plantableHere,
    speciesFn: (x, z, rnd) => (rnd() < 0.72 ? 'cedar' : 'maple'),
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
    origin: { x: 0, z: 0 },
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
