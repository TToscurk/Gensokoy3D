// 迷途竹林／永遠亭 —— 階段 3 遷移的第五張圖。
//
// 竹林是 buildVegetation 裡「固定位置的地景」之一（buildBamboo 依
// REGION bamboo 的世界座標下種）。分圖之後那批地景改成依範圍取捨，
// 所以只有這張圖會真的長出竹子 —— 別張圖不必再扛整片竹林。
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, buildTerrainSkirt, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField, setClearings } from '../../world/vegetation.js';
import { buildStructureSet } from '../../world/structures.js';
import { mergeStaticByMaterial } from '../../core/optimize.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.bamboo;

export const ORIGIN = { x: R.x, z: R.z };

export const meta = {
  id: 'bamboo',
  zh: '迷途竹林',
  en: 'BAMBOO FOREST OF THE LOST',
  size: 600,                       // 竹林半徑 235，永遠亭在裡面
  spawn: { x: 0, z: 80, facing: Math.PI },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
  // 從舊世界的高度場切出來的圖：遠景裙襬直接續用同一個高度場，
  // 天際線會是地理上真的那片地貌（規格書 §1）。
  heightSpace: 'world',
};

export const entries = {
  // 從魔法之森過來 —— 站在竹林的西北緣
  from_forest: { x: -230, z: -190, facing: Math.PI * 0.75 },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'bamboo_to_forest',
    to: 'forest',
    entry: 'from_bamboo',
    trigger: { x: -260, z: -225, r: 12 },
    label: '往魔法之森',
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
  group.name = 'map:bamboo';

  await progress?.(20, '鋪開竹林地表…');
  const seg = Math.max(48, Math.min(256, Math.round(meta.size / 4)));
  const terrain = buildTerrain(seg, { size: meta.size, ox: ORIGIN.x, oz: ORIGIN.z });
  group.add(terrain);

  // 遠景裙襬：地形之外一圈低解析度背景，延伸到霧之外，
  // 免得地圖邊緣被切出硬邊（1 個 draw call）。
  const skirt = buildTerrainSkirt(meta.size / 2, 1100, heightAt);
  group.add(skirt);

  await progress?.(48, '建起永遠亭…');
  const st = buildStructureSet(['bamboo']);
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

  await progress?.(72, '長出竹海…');
  const density = q.trees / (2400 * 0.92) ** 2;
  setClearings(st.clearings);
  const vegetation = buildVegetation(Math.round(density * meta.size ** 2), {
    cx: ORIGIN.x, cz: ORIGIN.z, half: meta.size / 2,
  });
  setClearings(null);
  vegetation.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(vegetation);

  await progress?.(88, '鋪上林下草地…');
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.5)) : null;
  if (grass) group.add(grass.mesh);

  // 迷途竹林：霧濃，雲少（抬頭是竹梢不是天）
  const atmosphere = new Atmosphere(Math.round(q.clouds * 0.25), Math.round(q.mist * 0.9));
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
    npcs: ['reisen', 'kaguya', 'eirin', 'mokou'],
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
