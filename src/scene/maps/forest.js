// 魔法之森 —— 階段 3 遷移的第二張圖。
//
// 判準同前：森林是既有地形上長出來的，切出來就能走，所以直接切。
// 這張圖的性格全在植被上 —— 扭曲的暗樹（gnarled）成片，
// 樹種決定仍走 speciesAt() 那套群落雜訊，跟舊世界長得一樣。
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, buildTerrainSkirt, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField, setClearings } from '../../world/vegetation.js';
import { buildStructureSet } from '../../world/structures.js';
import { mergeStaticByMaterial } from '../../core/optimize.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.forest;

export const ORIGIN = { x: R.x, z: R.z };

export const meta = {
  id: 'forest',
  zh: '魔法之森',
  en: 'FOREST OF MAGIC',
  size: 560,                       // 森林半徑 250，外圍留一圈過渡
  spawn: { x: 0, z: 40, facing: Math.PI },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
  // 從舊世界的高度場切出來的圖：遠景裙襬直接續用同一個高度場，
  // 天際線會是地理上真的那片地貌（規格書 §1）。
  heightSpace: 'world',
};

export const entries = {
  // 從里過來 —— 站在森林的東北緣，面向森林深處
  from_village: { x: 150, z: -186, facing: Math.PI * 0.75 },
  // 從竹林回來 —— 站在森林的東南緣
  from_bamboo: { x: 210, z: 220, facing: Math.PI * -0.75 },
  // 從無緣塚回來 —— 站在森林的西南緣
  from_muenzuka: { x: -168, z: 146, facing: Math.PI * 0.35 },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'forest_to_village',
    to: 'village',
    entry: 'from_forest',
    // 東北緣：出了森林就是往里的方向
    trigger: { x: 172, z: -212, r: 12 },
    label: '往人間之里',
    style: 'walk',
    condition: null,
  },
  {
    id: 'forest_to_bamboo',
    to: 'bamboo',
    entry: 'from_forest',
    // 東南緣：森林盡頭接上迷途竹林
    trigger: { x: 240, z: 250, r: 12 },
    label: '往迷途竹林',
    style: 'walk',
    condition: null,
  },
  {
    id: 'forest_to_muenzuka',
    to: 'muenzuka',
    entry: 'from_forest',
    // 西南緣：穿過森林深處是無緣者的墓所
    trigger: { x: -204, z: 177, r: 12 },
    label: '往無緣塚',
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
  group.name = 'map:forest';

  await progress?.(20, '鋪開森林地表…');
  const seg = Math.max(48, Math.min(256, Math.round(meta.size / 4)));
  const terrain = buildTerrain(seg, { size: meta.size, ox: ORIGIN.x, oz: ORIGIN.z });
  group.add(terrain);

  // 遠景裙襬：地形之外一圈低解析度背景，延伸到霧之外，
  // 免得地圖邊緣被切出硬邊（1 個 draw call）。
  const skirt = buildTerrainSkirt(meta.size / 2, 1100, heightAt);
  group.add(skirt);

  await progress?.(45, '搭起魔理沙邸…');
  const st = buildStructureSet(['forest']);
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

  const interactives = [];
  for (const inr of st.interiors) {
    const e = toLocal(inr.enter), ins = toLocal(inr.inside), ex = toLocal(inr.exit);
    interactives.push({
      id: inr.id + ':enter', label: `進入${inr.zh}`,
      x: e.x, z: e.z, y: e.y,
      to: { x: ins.x, z: ins.z, y: ins.y }, zh: inr.zh, msg: '推門而入…',
    });
    interactives.push({
      id: inr.id + ':exit', label: `離開${inr.zh}`,
      x: ins.x, z: ins.z, y: ins.y,
      to: { x: ex.x, z: ex.z, y: ex.y }, zh: inr.zh, msg: '回到戶外…',
    });
  }

  await progress?.(70, '長出扭曲的暗樹…');
  // 森林的樹比別處密（舊世界也是，靠 speciesAt 的森林分支），
  // 這裡的密度基準沿用全域值，讓分佈與舊世界一致。
  const density = q.trees / (2400 * 0.92) ** 2;
  setClearings(st.clearings);
  const vegetation = buildVegetation(Math.round(density * meta.size ** 2 * 1.6), {
    cx: ORIGIN.x, cz: ORIGIN.z, half: meta.size / 2,
  });
  setClearings(null);
  vegetation.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(vegetation);

  await progress?.(85, '鋪上林地草叢…');
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.6)) : null;
  if (grass) group.add(grass.mesh);

  // 魔法之森是全幻想鄉霧最濃的地方 —— 雲少、霧多
  const atmosphere = new Atmosphere(Math.round(q.clouds * 0.3), Math.round(q.mist * 0.9));
  group.add(atmosphere.group);

  return {
    group,
    heightAt,
    origin: ORIGIN,
    colliders,
    lanterns,
    staticLights,
    interactives,
    clearings,
    portals,
    npcs: ['marisa', 'rumia'],
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
