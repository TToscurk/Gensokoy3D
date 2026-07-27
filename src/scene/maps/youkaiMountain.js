// 妖怪之山（山麓）—— 階段 3 遷移。索道山麓站與山溪下游。
//
// 這張圖的原點不在地區圓心，而在**索道山麓站**（-408,-536）：
// 站體是這張圖的主角，ropeway 的兩端世界座標是固定的。
// 沒有住民掛在這個 region，所以 ORIGIN 不必對齊 roster 的地區中心。
//
// 索道是 portal（style: 'vehicle'），不是動畫（規格書 §1）：
// 這張圖只畫山麓站 + 下半段纜線 + 一台停靠車廂，
// 纜線在 t=0.5 處收進霧裡，上半段是守矢那張圖的事。
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, buildTerrainSkirt, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField, setClearings, captureClearings } from '../../world/vegetation.js';
import { buildRopewayHalf } from '../../world/structures.js';
import { buildRiver, updateWater } from '../../world/water.js';
import { mergeStaticByMaterial } from '../../core/optimize.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.youkaiMountain;

// 原點 = 索道山麓站（ropewayLine 的 foot，世界座標固定）
export const ORIGIN = { x: -408, z: -536 };

export const meta = {
  id: 'youkaiMountain',
  zh: '妖怪之山',
  en: 'YOUKAI MOUNTAIN',
  size: 480,
  spawn: { x: 14, z: 10, facing: Math.PI * 0.5 },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
  heightSpace: 'world',
};

export const entries = {
  // 從霧之湖翻埡口過來 —— 站在站體北側的山徑上
  from_lake: { x: 18, z: -112, facing: Math.PI * -0.1 },
  // 從天狗聚落下來 —— 站在站體西側的坡道上
  from_tenguVillage: { x: -186, z: -22, facing: Math.PI * 0.4 },
  // 搭索道下來 —— 月台西北端（與山坡齊平的那側），不給 y 就貼地
  from_moriya: { x: -9, z: -5, facing: Math.PI * 0.9 },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'mountain_to_lake',
    to: 'lake',
    entry: 'from_mountain',
    // 站體北側的埡口：翻過去就是下霧之湖的坡（實測 86.8m，乾燥）
    trigger: { x: 22, z: -104, r: 12 },
    label: '往霧之湖',
    style: 'walk',
    condition: null,
  },
  {
    id: 'mountain_to_tenguVillage',
    to: 'tenguVillage',
    entry: 'from_mountain',
    // 西側山徑：一路上坡到天狗聚落（281m 稜線，健行路線）
    trigger: { x: -226, z: -28, r: 12 },
    label: '往天狗聚落',
    style: 'walk',
    condition: null,
  },
  {
    id: 'mountain_to_moriya',
    to: 'moriya',
    entry: 'from_ropeway',
    // 月台：踏上月台就是搭乘。觸發半徑刻意小（3.2m），
    // 路過站體不會被吸進去；entry 距離 10m 以上不會來回彈跳
    trigger: { x: 0, z: 0, r: 3.2 },
    label: '搭乘索道（往山上）',
    style: 'vehicle',
    condition: null,
  },
];

export function heightAt(x, z) {
  return terrainHeight(x + ORIGIN.x, z + ORIGIN.z);
}

export async function build(ctx) {
  const { quality: q, progress } = ctx;
  const group = new THREE.Group();
  group.name = 'map:youkaiMountain';

  await progress?.(20, '削出山麓的坡…');
  const seg = Math.max(48, Math.min(256, Math.round(meta.size / 4)));
  const terrain = buildTerrain(seg, { size: meta.size, ox: ORIGIN.x, oz: ORIGIN.z });
  group.add(terrain);

  const skirt = buildTerrainSkirt(meta.size / 2, 1100, heightAt);
  group.add(skirt);

  await progress?.(45, '架起索道山麓站…');
  // 站體＋下半段纜線＋停靠車廂。除草區收成這張圖的一份，
  // 不能像 buildStructureSet 那樣直接呼叫（會污染 legacy_open 的全域清單）
  const rwColliders = [];
  let rwGroup;
  const rwCaps = captureClearings(() => {
    rwGroup = buildRopewayHalf(rwColliders, 'foot');
  });
  mergeStaticByMaterial(rwGroup, ['rope-cabin']);
  rwGroup.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(rwGroup);

  await progress?.(55, '引下風神湖的山溪…');
  // 山溪整條建（1 個 draw call）：下游收口在霧之湖北緣，
  // 從山麓望去是一條真的地理連線，不是圖邊切斷的水帶
  const river = buildRiver();
  river.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(river);

  const toLocal = o => ({ ...o, x: o.x - ORIGIN.x, z: o.z - ORIGIN.z });
  const colliders = rwColliders.map(toLocal);
  const clearings = rwCaps.map(toLocal);

  await progress?.(70, '種下山麓的樹…');
  const density = q.trees / (2400 * 0.92) ** 2;
  setClearings(rwCaps);
  const vegetation = buildVegetation(Math.round(density * meta.size ** 2), {
    cx: ORIGIN.x, cz: ORIGIN.z, half: meta.size / 2,
  });
  setClearings(null);
  vegetation.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(vegetation);

  await progress?.(85, '鋪上草地…');
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.6)) : null;
  if (grass) group.add(grass.mesh);

  const atmosphere = new Atmosphere(Math.round(q.clouds * 0.6), Math.round(q.mist * 0.5));
  group.add(atmosphere.group);

  return {
    group,
    heightAt,
    origin: ORIGIN,
    colliders,
    lanterns: [],
    staticLights: [],
    interactives: [],
    clearings,
    portals,
    npcs: [],
    mobs: [],
    terrain, vegetation, grass, atmosphere, river,

    update(dt, t, rt) {
      updateWater(river, dt, rt.sunDir);
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
