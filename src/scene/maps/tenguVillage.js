// 天狗聚落 —— 階段 3 遷移。山腰的木造聚落與九天瀑布。
// 瀑布的 uTime 由主迴圈全域推進（FALLS 是共享 uniform），
// 山溪整條建進來，瀑布才不會從乾河床裡噴出來。
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, buildTerrainSkirt, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField, setClearings } from '../../world/vegetation.js';
import { buildStructureSet } from '../../world/structures.js';
import { buildRiver, updateWater } from '../../world/water.js';
import { mergeStaticByMaterial } from '../../core/optimize.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.tenguVillage;

export const ORIGIN = { x: R.x, z: R.z };

export const meta = {
  id: 'tenguVillage',
  zh: '天狗聚落',
  en: 'TENGU SETTLEMENT',
  size: 320,
  spawn: { x: 0, z: 40, facing: 0 },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
  heightSpace: 'world',
};

export const entries = {
  // 從山麓站上來 —— 站在聚落的東側坡道
  from_mountain: { x: 118, z: 14, facing: Math.PI * -0.45 },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'tenguVillage_to_mountain',
    to: 'youkaiMountain',
    entry: 'from_tenguVillage',
    // 東側山徑：下坡回索道山麓站
    trigger: { x: 146, z: 18, r: 10 },
    label: '往山麓（索道站）',
    style: 'walk',
    condition: null,
  },
];

export function heightAt(x, z) {
  return terrainHeight(x + ORIGIN.x, z + ORIGIN.z);
}

export async function build(ctx) {
  const { quality: q, progress } = ctx;
  const group = new THREE.Group();
  group.name = 'map:tenguVillage';

  await progress?.(20, '削出山腰的聚落台地…');
  const seg = Math.max(48, Math.min(256, Math.round(meta.size / 4)));
  const terrain = buildTerrain(seg, { size: meta.size, ox: ORIGIN.x, oz: ORIGIN.z });
  group.add(terrain);

  const skirt = buildTerrainSkirt(meta.size / 2, 1100, heightAt);
  group.add(skirt);

  await progress?.(50, '搭起聚會所與瞭望台…');
  const st = buildStructureSet(['tenguVillage']);
  mergeStaticByMaterial(st.root, ['clock-hands', 'rope-cabin']);
  st.root.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(st.root);

  await progress?.(62, '引下九天瀑布的山溪…');
  const river = buildRiver();
  river.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(river);

  const toLocal = o => ({ ...o, x: o.x - ORIGIN.x, z: o.z - ORIGIN.z });
  const colliders = st.colliders.map(toLocal);
  const lanterns = st.lights.map(toLocal);
  const clearings = st.clearings.map(toLocal);
  const staticLights = st.staticLights.map(l => {
    l.position.x -= ORIGIN.x;
    l.position.z -= ORIGIN.z;
    return l;
  });

  await progress?.(72, '種下山腰的樹…');
  const density = q.trees / (2400 * 0.92) ** 2;
  setClearings(st.clearings);
  const vegetation = buildVegetation(Math.round(density * meta.size ** 2), {
    cx: ORIGIN.x, cz: ORIGIN.z, half: meta.size / 2,
  });
  setClearings(null);
  vegetation.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(vegetation);

  await progress?.(86, '鋪上草地…');
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.5)) : null;
  if (grass) group.add(grass.mesh);

  const atmosphere = new Atmosphere(Math.round(q.clouds * 0.6), Math.round(q.mist * 0.6));
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
    npcs: ['aya'],
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
