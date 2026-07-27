// 霧之湖 —— 階段 3 遷移的第三張圖，也是第一張帶水面的圖。
//
// 反射水面用 RenderTarget（512²），是規格書 §4 #12 特別點名的洩漏來源：
// 沒水的圖不要建，有水的圖 dispose 時要把它還回去。
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField, setClearings } from '../../world/vegetation.js';
import { buildWater, updateWater, buildLakeDressing } from '../../world/water.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.lake;

export const ORIGIN = { x: R.x, z: R.z };

export const meta = {
  id: 'lake',
  zh: '霧之湖',
  en: 'MISTY LAKE',
  size: 520,                       // 湖半徑 195，加上湖岸與外圍林地
  spawn: { x: 100, z: 180, facing: Math.PI * 0.75 },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
};

export const entries = {
  // 從里過來 —— 站在湖的東南岸，面向湖心
  from_village: { x: 100, z: 180, facing: Math.PI * 0.75 },
  // 從紅魔館回來 —— 站在湖的西岸
  from_sdm: { x: -160, z: 50, facing: Math.PI * -0.5 },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'lake_to_village',
    to: 'village',
    entry: 'from_lake',
    trigger: { x: 120, z: 205, r: 12 },
    label: '往人間之里',
    style: 'walk',
    condition: null,
  },
  {
    id: 'lake_to_sdm',
    to: 'sdm',
    entry: 'from_lake',
    // 西岸：湖的對岸就是紅魔館（原作的地理關係）
    trigger: { x: -180, z: 60, r: 12 },
    label: '往紅魔館',
    style: 'walk',
    condition: null,
  },
];

export function heightAt(x, z) {
  return terrainHeight(x + ORIGIN.x, z + ORIGIN.z);
}

export async function build(ctx) {
  const { quality: q, renderer, progress } = ctx;
  const group = new THREE.Group();
  group.name = 'map:lake';

  await progress?.(20, '掘出湖盆…');
  const seg = Math.max(48, Math.min(256, Math.round(meta.size / 4)));
  const terrain = buildTerrain(seg, { size: meta.size, ox: ORIGIN.x, oz: ORIGIN.z });
  group.add(terrain);

  await progress?.(50, '注入霧之湖…');
  // buildWater 建在世界座標（以 REGION lake 為心），整組平移回這張圖的原點。
  const waterRoot = new THREE.Group();
  waterRoot.name = 'lake-water';
  const water = buildWater(q.waterReflect, renderer);
  waterRoot.add(water);
  waterRoot.add(buildLakeDressing());
  waterRoot.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(waterRoot);

  await progress?.(70, '種下湖岸林…');
  const density = q.trees / (2400 * 0.92) ** 2;
  setClearings(null);
  const vegetation = buildVegetation(Math.round(density * meta.size ** 2), {
    cx: ORIGIN.x, cz: ORIGIN.z, half: meta.size / 2,
  });
  vegetation.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(vegetation);

  await progress?.(85, '鋪上湖岸草地…');
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.6)) : null;
  if (grass) group.add(grass.mesh);

  // 湖面霧氣是這張圖的招牌
  const atmosphere = new Atmosphere(Math.round(q.clouds * 0.4), Math.round(q.mist * 1.0));
  group.add(atmosphere.group);

  return {
    group,
    heightAt,
    origin: ORIGIN,
    colliders: [],
    lanterns: [],
    staticLights: [],
    // 沒有建築，但要讓 applyEnv 認得這張圖「自帶內容」，
    // 否則會被當成 legacy_open 把舊世界的持久層裝回來。
    interactives: [],
    ownsContent: true,
    clearings: [],
    portals,
    npcs: ['cirno', 'daiyousei'],
    mobs: [],
    terrain, vegetation, grass, atmosphere, water,

    update(dt, t, rt) {
      updateWater(water, dt, rt.sunDir);
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
      // 反射水面的 RenderTarget（規格書 §4 #12）—— 不還回去，
      // 每進出一次湖就留一張 512² 在 GPU 上。
      water?.material?.uniforms?.mirrorSampler?.value?.dispose?.();
      group.removeFromParent();
    },
  };
}
