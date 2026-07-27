// 彼岸 —— 階段 3 遷移。三途川岸，小町擺渡、映姫審判亡者的地方。
// 與幻想鄉之間隔著最薄的結界，門開在無緣塚的深淵底。
// 三途川與渡船都建在建築組裡（一道灰黑色的長水面，不是 shader 水），
// 岸邊的彼岸花由植被系統依地區規則自動撒下。
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, buildTerrainSkirt, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField, setClearings } from '../../world/vegetation.js';
import { buildStructureSet } from '../../world/structures.js';
import { mergeStaticByMaterial } from '../../core/optimize.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.higan;

export const ORIGIN = { x: R.x, z: R.z };

export const meta = {
  id: 'higan',
  zh: '彼岸',
  en: 'HIGAN',
  size: 360,
  spawn: { x: 0, z: 90, facing: 0 },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
  heightSpace: 'world',
};

export const entries = {
  // 從無緣塚的深淵穿過來 —— 落在河岸對側的高地上，回頭就是三途川
  from_muenzuka: { x: 0, z: 90, facing: 0 },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'higan_to_muenzuka',
    to: 'muenzuka',
    entry: 'from_higan',
    // 河岸對側高地的邊緣 —— 活人不該久留的地方
    trigger: { x: 0, z: 112, r: 5 },
    label: '回到現世（無緣塚）',
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
  group.name = 'map:higan';

  await progress?.(20, '鋪開灰燼色的河岸…');
  const seg = Math.max(48, Math.min(256, Math.round(meta.size / 4)));
  const terrain = buildTerrain(seg, { size: meta.size, ox: ORIGIN.x, oz: ORIGIN.z });
  group.add(terrain);

  const skirt = buildTerrainSkirt(meta.size / 2, 1100, heightAt);
  group.add(skirt);

  await progress?.(50, '立起裁判廳與渡船…');
  const st = buildStructureSet(['higan']);
  mergeStaticByMaterial(st.root, ['clock-hands', 'rope-cabin']);
  st.root.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(st.root);

  const toLocal = o => ({ ...o, x: o.x - ORIGIN.x, z: o.z - ORIGIN.z });
  const colliders = st.colliders.map(toLocal);
  const lanterns = st.lights.map(toLocal);
  const clearings = st.clearings.map(toLocal);
  // 廳前的鐵鑄燭台，長明不滅
  const staticLights = st.staticLights.map(l => {
    l.position.x -= ORIGIN.x;
    l.position.z -= ORIGIN.z;
    return l;
  });

  await progress?.(70, '撒下岸邊的彼岸花…');
  const density = q.trees / (2400 * 0.92) ** 2;
  setClearings(st.clearings);
  const vegetation = buildVegetation(Math.round(density * meta.size ** 2), {
    cx: ORIGIN.x, cz: ORIGIN.z, half: meta.size / 2,
  });
  setClearings(null);
  vegetation.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(vegetation);

  await progress?.(85, '鋪上灰草…');
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.5)) : null;
  if (grass) group.add(grass.mesh);

  // 彼岸的天是灰的：雲少、霧重，河上永遠飄著一層
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
    npcs: ['komachi', 'shikieiki'],
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
