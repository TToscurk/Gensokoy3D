// 天界 —— 階段 3 遷移。雲上的白石台地，比那名居天子的住處。
// 台地只比圖心大一點，邊緣之外是直落雲海的陡坡 ——
// 出入口就壓在台地邊緣（實測 z=60 地面 335m，z=66 已經開始下坡），
// 金白鳥居立在邊緣外的空中，路過看看就好，走不過去。
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, buildTerrainSkirt, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField, setClearings } from '../../world/vegetation.js';
import { buildStructureSet } from '../../world/structures.js';
import { mergeStaticByMaterial } from '../../core/optimize.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.tenkai;

export const ORIGIN = { x: R.x, z: R.z };

export const meta = {
  id: 'tenkai',
  zh: '天界',
  en: 'BHAVA-AGRA',
  size: 300,
  spawn: { x: 0, z: 44, facing: 0 },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
  heightSpace: 'world',
};

export const entries = {
  // 從守矢神社的門上來 —— 落在涼亭與台地邊緣之間的白石地面
  from_moriya: { x: 0, z: 44, facing: 0 },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'tenkai_to_moriya',
    to: 'moriya',
    entry: 'from_tenkai',
    // 台地邊緣：再往外就是雲海。觸發半徑刻意小，路過不會誤踩
    trigger: { x: 0, z: 60, r: 5 },
    label: '穿過雲端（回守矢神社）',
    style: 'gate',
    condition: null,
  },
];

export function heightAt(x, z) {
  return terrainHeight(x + ORIGIN.x, z + ORIGIN.z);
}

export async function build(ctx) {
  const { quality: q, progress } = ctx;
  const group = new THREE.Group();
  group.name = 'map:tenkai';

  await progress?.(20, '升起雲上的台地…');
  const seg = Math.max(48, Math.min(256, Math.round(meta.size / 4)));
  const terrain = buildTerrain(seg, { size: meta.size, ox: ORIGIN.x, oz: ORIGIN.z });
  group.add(terrain);

  const skirt = buildTerrainSkirt(meta.size / 2, 1100, heightAt);
  group.add(skirt);

  await progress?.(50, '立起白石涼亭與注連劍…');
  const st = buildStructureSet(['tenkai']);
  mergeStaticByMaterial(st.root, ['clock-hands', 'rope-cabin']);
  st.root.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(st.root);

  const toLocal = o => ({ ...o, x: o.x - ORIGIN.x, z: o.z - ORIGIN.z });
  const colliders = st.colliders.map(toLocal);
  const lanterns = st.lights.map(toLocal);
  const clearings = st.clearings.map(toLocal);
  // 亭下的燭台是常亮燈 —— 天界沒有晝夜之分那種寂靜感
  const staticLights = st.staticLights.map(l => {
    l.position.x -= ORIGIN.x;
    l.position.z -= ORIGIN.z;
    return l;
  });

  await progress?.(70, '點上疏疏落落的櫻…');
  const density = q.trees / (2400 * 0.92) ** 2;
  setClearings(st.clearings);
  const vegetation = buildVegetation(Math.round(density * meta.size ** 2), {
    cx: ORIGIN.x, cz: ORIGIN.z, half: meta.size / 2,
  });
  setClearings(null);
  vegetation.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(vegetation);

  await progress?.(85, '鋪上台地的草…');
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.5)) : null;
  if (grass) group.add(grass.mesh);

  // 雲海是這張圖的主角：雲多拉滿，霧收起來（雲上不需要霧）
  const atmosphere = new Atmosphere(Math.round(q.clouds * 1.0), Math.round(q.mist * 0.2));
  group.add(atmosphere.group);

  return {
    group,
    heightAt,
    origin: ORIGIN,
    colliders,
    lanterns,
    staticLights,
    interactives: [],
    clearings,
    portals,
    npcs: ['tenshi'],
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
