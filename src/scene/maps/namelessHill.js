// 無名之丘 —— 階段 3 遷移。鈴蘭咲く丘。
// 沒有建築（structures.js 沒有這個地區的 builder），
// 地景主體是 buildVegetation 依範圍種下的固定地景「鈴蘭」。
// 與霧之湖同型：ownsContent 明講，免得被 applyEnv 誤判成 legacy_open。
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, buildTerrainSkirt, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField, setClearings } from '../../world/vegetation.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.namelessHill;

export const ORIGIN = { x: R.x, z: R.z };

export const meta = {
  id: 'namelessHill',
  zh: '無名之丘',
  en: 'NAMELESS HILL',
  size: 420,
  spawn: { x: 0, z: 60, facing: 0 },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
  heightSpace: 'world',
};

export const entries = {
  // 從迷途竹林過來 —— 站在丘的西緣
  from_bamboo: { x: -152, z: 62, facing: Math.PI * -0.4 },
  // 從太陽花田回來 —— 站在丘的東南緣
  from_sunflower: { x: 96, z: -128, facing: Math.PI * 0.55 },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'namelessHill_to_bamboo',
    to: 'bamboo',
    entry: 'from_namelessHill',
    trigger: { x: -186, z: 76, r: 10 },
    label: '往迷途竹林',
    style: 'walk',
    condition: null,
  },
  {
    id: 'namelessHill_to_sunflower',
    to: 'sunflower',
    entry: 'from_namelessHill',
    trigger: { x: 120, z: -160, r: 10 },
    label: '往太陽花田',
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
  group.name = 'map:namelessHill';

  await progress?.(20, '整平丘稜…');
  const seg = Math.max(48, Math.min(256, Math.round(meta.size / 4)));
  const terrain = buildTerrain(seg, { size: meta.size, ox: ORIGIN.x, oz: ORIGIN.z });
  group.add(terrain);

  const skirt = buildTerrainSkirt(meta.size / 2, 1100, heightAt);
  group.add(skirt);

  await progress?.(60, '種下滿丘的鈴蘭…');
  const density = q.trees / (2400 * 0.92) ** 2;
  const vegetation = buildVegetation(Math.round(density * meta.size ** 2), {
    cx: ORIGIN.x, cz: ORIGIN.z, half: meta.size / 2,
  });
  vegetation.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(vegetation);

  await progress?.(85, '鋪上草地…');
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.6)) : null;
  if (grass) group.add(grass.mesh);

  // 鈴蘭的毒霧 —— 丘上的霧比別處明顯
  const atmosphere = new Atmosphere(Math.round(q.clouds * 0.4), Math.round(q.mist * 0.7));
  group.add(atmosphere.group);

  return {
    group,
    heightAt,
    origin: ORIGIN,
    colliders: [],
    lanterns: [],
    staticLights: [],
    interactives: [],
    ownsContent: true,
    clearings: [],
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
