// 白玉樓 —— 階段 3 遷移，第一張「結界之外」的圖。
// 冥界不在幻想鄉的地理內，來回都走 gate 過場（黑幕＋進度條），
// 對外的門開在博麗神社 —— 大結界最薄的一線。
// 西行妖與長階梯都在建築組裡；櫻花吹雪是全域 fx，
// 由 main.js 在進這張圖時把錨點平移過來（世界座標 → 圖局部座標）。
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, buildTerrainSkirt, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField, setClearings } from '../../world/vegetation.js';
import { buildStructureSet } from '../../world/structures.js';
import { mergeStaticByMaterial } from '../../core/optimize.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.netherworld;

export const ORIGIN = { x: R.x, z: R.z };

export const meta = {
  id: 'netherworld',
  zh: '白玉樓',
  en: 'HAKUGYOKUROU',
  size: 400,
  spawn: { x: 0, z: 90, facing: 0 },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
  heightSpace: 'world',
};

export const entries = {
  // 跨過結界過來 —— 落在長階梯中段、石燈籠夾道之間
  from_shrine: { x: 0, z: 90, facing: 0 },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'netherworld_to_shrine',
    to: 'shrine',
    entry: 'from_netherworld',
    // 長階梯的最下方 —— 走完階梯就是回現世的門
    trigger: { x: 0, z: 112, r: 5 },
    label: '回到現世（博麗神社）',
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
  group.name = 'map:netherworld';

  await progress?.(20, '鋪開冥界的庭園…');
  const seg = Math.max(48, Math.min(256, Math.round(meta.size / 4)));
  const terrain = buildTerrain(seg, { size: meta.size, ox: ORIGIN.x, oz: ORIGIN.z });
  group.add(terrain);

  const skirt = buildTerrainSkirt(meta.size / 2, 1100, heightAt);
  group.add(skirt);

  await progress?.(50, '立起白玉樓與西行妖…');
  const st = buildStructureSet(['netherworld']);
  mergeStaticByMaterial(st.root, ['clock-hands', 'rope-cabin']);
  st.root.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(st.root);

  const toLocal = o => ({ ...o, x: o.x - ORIGIN.x, z: o.z - ORIGIN.z });
  const colliders = st.colliders.map(toLocal);
  const lanterns = st.lights.map(toLocal);
  const clearings = st.clearings.map(toLocal);
  const staticLights = st.staticLights.map(l => {
    l.position.x -= ORIGIN.x;
    l.position.z -= ORIGIN.z;
    return l;
  });

  await progress?.(70, '種下滿開的櫻…');
  const density = q.trees / (2400 * 0.92) ** 2;
  setClearings(st.clearings);
  const vegetation = buildVegetation(Math.round(density * meta.size ** 2), {
    cx: ORIGIN.x, cz: ORIGIN.z, half: meta.size / 2,
  });
  setClearings(null);
  vegetation.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(vegetation);

  await progress?.(85, '鋪上庭園的草…');
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.6)) : null;
  if (grass) group.add(grass.mesh);

  const atmosphere = new Atmosphere(Math.round(q.clouds * 0.5), Math.round(q.mist * 0.8));
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
    npcs: ['youmu', 'yuyuko'],
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
