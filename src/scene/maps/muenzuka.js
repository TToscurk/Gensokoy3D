// 無緣塚 —— 階段 3 遷移。無緣者的墓所，石塔林立。
// 這裡與彼岸之間的結界最薄（求聞史紀：紫の桜の咲く場所），
// 所以通往彼岸的 gate portal 開在這張圖，深淵側的空地。
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, buildTerrainSkirt, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField, setClearings } from '../../world/vegetation.js';
import { buildStructureSet } from '../../world/structures.js';
import { mergeStaticByMaterial } from '../../core/optimize.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.muenzuka;

export const ORIGIN = { x: R.x, z: R.z };

export const meta = {
  id: 'muenzuka',
  zh: '無緣塚',
  en: 'MUENZUKA',
  size: 280,
  spawn: { x: 0, z: 40, facing: 0 },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
  heightSpace: 'world',
};

export const entries = {
  // 從魔法之森過來 —— 站在墓所的東北緣
  from_forest: { x: 78, z: -66, facing: Math.PI * 0.75 },
  // 從彼岸回來 —— 落在深淵底的空地，四周是無緣者的石塔
  // 從彼岸回來。往東挪到坡道上（9.5m）—— 原本在 (-70,46) 地面只有 -2.4m，
  // 那是通往彼岸的窪地底部（水面 0），從彼岸回來會直接落進水裡。
  // 觸發區刻意留在窪底（結界最薄之處），但**落點不該跟著留在那裡**。
  from_higan: { x: -50, z: 46, facing: Math.PI * 0.35 },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'muenzuka_to_forest',
    to: 'forest',
    entry: 'from_muenzuka',
    trigger: { x: 100, z: -86, r: 10 },
    label: '往魔法之森',
    style: 'walk',
    condition: null,
  },
  {
    id: 'muenzuka_to_higan',
    to: 'higan',
    entry: 'from_muenzuka',
    // 深淵底：這裡與彼岸之間的結界最薄（求聞史紀：紫の桜の咲く場所）。
    // 窪地實測 -1.5 ~ -4.5m，往東北有連續坡道爬回墓所（21m）
    trigger: { x: -90, z: 60, r: 8 },
    label: '深淵之門（往彼岸）',
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
  group.name = 'map:muenzuka';

  await progress?.(20, '整平墓所…');
  const seg = Math.max(48, Math.min(256, Math.round(meta.size / 4)));
  const terrain = buildTerrain(seg, { size: meta.size, ox: ORIGIN.x, oz: ORIGIN.z });
  group.add(terrain);

  const skirt = buildTerrainSkirt(meta.size / 2, 1100, heightAt);
  group.add(skirt);

  await progress?.(50, '立起石塔群…');
  const st = buildStructureSet(['muenzuka']);
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

  await progress?.(70, '種下墓所旁的樹…');
  const density = q.trees / (2400 * 0.92) ** 2;
  setClearings(st.clearings);
  const vegetation = buildVegetation(Math.round(density * meta.size ** 2), {
    cx: ORIGIN.x, cz: ORIGIN.z, half: meta.size / 2,
  });
  setClearings(null);
  vegetation.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(vegetation);

  await progress?.(85, '鋪上草地…');
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.6)) : null;
  if (grass) group.add(grass.mesh);

  // 墓所的霧比別處重
  const atmosphere = new Atmosphere(Math.round(q.clouds * 0.3), Math.round(q.mist * 1.0));
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
    npcs: ['seiga', 'miyako'],
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
