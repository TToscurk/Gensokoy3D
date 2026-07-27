// 人間之里 —— 階段 3 遷移的第一張圖。
//
// 遷移判準（階段 2 定下的）：能切就切，切出來不好走就自己造。
// 人間之里是被地形壓平過的台地，切出來就能走，所以照 shrine 的做法切。
//
// 座標系：局部座標，原點在里的中心。地貌照世界座標取樣，
// 所以街廓、田壟、町屋的相對位置跟舊世界完全一致。
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField, setClearings } from '../../world/vegetation.js';
import { buildStructureSet } from '../../world/structures.js';
import { Atmosphere } from '../../fx/atmosphere.js';

const R = REGION_BY_ID.village;

export const ORIGIN = { x: R.x, z: R.z };

export const meta = {
  id: 'village',
  zh: '人間之里',
  en: 'HUMAN VILLAGE',
  size: 480,                       // 里的半徑 205，留一圈田園與外圍
  spawn: { x: 0, z: 40, facing: Math.PI },
  fog: R.fog,
  accent: R.accent,
  sky: 'day',
  bgm: null,
};

export const entries = {
  // 從參道下來 —— 站在里的北緣，面向里中心
  from_sando: { x: 0, z: -190, facing: Math.PI },
  default: meta.spawn,
};

export const portals = [
  {
    id: 'village_to_sando',
    to: 'sando',
    entry: 'from_village',
    // 里的北緣：往北出了村口就是上山的參道
    trigger: { x: 0, z: -220, r: 10 },
    label: '往參道',
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
  group.name = 'map:village';

  await progress?.(20, '整平里的台地…');
  const seg = Math.max(48, Math.min(256, Math.round(meta.size / 4)));
  const terrain = buildTerrain(seg, { size: meta.size, ox: ORIGIN.x, oz: ORIGIN.z });
  group.add(terrain);

  // 建築排在植被之前：町屋、街道、廣場會登記除草區，
  // 植被的 plantable() 讀的就是那份清單，順序反了會長草在石板路上。
  await progress?.(50, '搭起町屋與市集…');
  const st = buildStructureSet(['village']);
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

  await progress?.(70, '種下里外的雜木…');
  const density = q.trees / (2400 * 0.92) ** 2;
  // 下種與 plantable() 都在世界座標，所以先換上這張圖的除草區（換算前那份）
  setClearings(st.clearings);
  const vegetation = buildVegetation(Math.round(density * meta.size ** 2), {
    cx: ORIGIN.x, cz: ORIGIN.z, half: meta.size / 2,
  });
  setClearings(null);
  vegetation.position.set(-ORIGIN.x, 0, -ORIGIN.z);
  group.add(vegetation);

  await progress?.(85, '鋪上草原…');
  const grass = q.grass > 0 ? new GrassField(Math.round(q.grass * 0.6)) : null;
  if (grass) group.add(grass.mesh);

  const atmosphere = new Atmosphere(Math.round(q.clouds * 0.5), Math.round(q.mist * 0.5));
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
    // roster 的 region 欄位說了算：慧音、緣一、阿福婆、里的小孩
    npcs: ['keine', 'yoriichi', 'dangoBaa', 'villageKid'],
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
