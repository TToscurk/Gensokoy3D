// 人間之里 —— 階段 3 遷移的第一張圖。
//
// 遷移判準（階段 2 定下的）：能切就切，切出來不好走就自己造。
// 人間之里是被地形壓平過的台地，切出來就能走，所以照 shrine 的做法切。
//
// 座標系：局部座標，原點在里的中心。地貌照世界座標取樣，
// 所以街廓、田壟、町屋的相對位置跟舊世界完全一致。
import * as THREE from 'three';
import { REGION_BY_ID } from '../../config.js';
import { buildTerrain, buildTerrainSkirt, terrainHeight } from '../../world/terrain.js';
import { buildVegetation, GrassField, setClearings } from '../../world/vegetation.js';
import { buildStructureSet } from '../../world/structures.js';
import { mergeStaticByMaterial } from '../../core/optimize.js';
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
  // 從舊世界的高度場切出來的圖：遠景裙襬直接續用同一個高度場，
  // 天際線會是地理上真的那片地貌（規格書 §1）。
  heightSpace: 'world',
};

export const entries = {
  // 從參道下來 —— 站在里的北緣，面向里中心
  from_sando: { x: 0, z: -190, facing: Math.PI },
  // 從森林回來 —— 站在里的西南緣，面向里中心
  from_forest: { x: -150, z: 186, facing: Math.PI * -0.25 },
  // 從湖回來 —— 站在里的西北緣
  from_lake: { x: -160, z: -140, facing: Math.PI * 0.75 },
  // 從命蓮寺回來 —— 站在里的西緣
  from_myouren: { x: -195, z: -42, facing: Math.PI * -0.5 },
  // 從香霖堂回來 —— 站在里的南緣（香霖堂在里與森林之間的路上；
  // 兩圖之間是片濕原窪地，出入口繞到南緣的乾燥段）
  from_kourindou: { x: 40, z: 190, facing: Math.PI * -0.1 },
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
  {
    id: 'village_to_forest',
    to: 'forest',
    entry: 'from_village',
    // 西南緣：里的外圍田園再過去就是魔法之森
    trigger: { x: -172, z: 212, r: 12 },
    label: '往魔法之森',
    style: 'walk',
    condition: null,
  },
  {
    id: 'village_to_lake',
    to: 'lake',
    entry: 'from_village',
    // 西北緣：出了里往北就是霧之湖
    trigger: { x: -180, z: -160, r: 12 },
    label: '往霧之湖',
    style: 'walk',
    condition: null,
  },
  {
    id: 'village_to_myouren',
    to: 'myouren',
    entry: 'from_village',
    // 西緣：命蓮寺在里西方的丘上
    trigger: { x: -225, z: -48, r: 10 },
    label: '往命蓮寺',
    style: 'walk',
    condition: null,
  },
  {
    id: 'village_to_kourindou',
    to: 'kourindou',
    entry: 'from_village',
    // 南緣：往森林的路上會先經過香霖堂。
    // 注意不在西南直線上 —— 那一帶是低於水準面的濕原窪地，
    // 出入口放在南緣的乾燥段（實測高度 10.7m）
    trigger: { x: 50, z: 222, r: 10 },
    label: '往香霖堂',
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

  // 遠景裙襬：地形之外一圈低解析度背景，延伸到霧之外，
  // 免得地圖邊緣被切出硬邊（1 個 draw call）。
  const skirt = buildTerrainSkirt(meta.size / 2, 1100, heightAt);
  group.add(skirt);

  // 建築排在植被之前：町屋、街道、廣場會登記除草區，
  // 植被的 plantable() 讀的就是那份清單，順序反了會長草在石板路上。
  await progress?.(50, '搭起町屋與市集…');
  const st = buildStructureSet(['village']);
  // 建築完全靜態 —— 依材質合併成少數大網格，跟舊世界同一套心法。
  // 必須在平移之前做：合併會把世界矩陣烘進頂點。
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
